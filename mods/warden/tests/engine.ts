import type { On } from 'claude-code'

export type World = {
  files?: Record<string, string>
  git?: Record<string, string>
  verdict?: 'allow' | 'ask' | 'deny'
  answers?: string[]
  questions?: string[]
  cwds?: string[]
  onBash?: (command: string) => void
}

export function engineBeneath(on: On, world: World = {}): void {
  const files = world.files ?? {}
  const git = world.git
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    world.cwds?.push(e.init?.cwd ?? '')
    const [tool, ...args] = e.argv
    const stdout = tool === 'git' && git !== undefined ? git[args.join(' ')] : undefined
    return stdout === undefined
      ? { value: { exitCode: 128, stdout: '', stderr: 'fatal', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined || Object.keys(files).some(path => path.startsWith(`${e.path}/`)) }))
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') world.onBash?.((e as unknown as { command: string }).command)
    if (e.tool !== 'AskUserQuestion') return { result: {}, text: 'ok' }
    const questions = (e as unknown as { questions: Array<{ question: string }> }).questions
    const question = questions[0]?.question ?? ''
    world.questions?.push(question)
    const answer = world.answers?.shift()
    if (answer === undefined) throw new Error('the dialog was dismissed')
    return { result: { questions, answers: { [question]: answer } }, text: answer }
  })
  on('tool.check', () => ({ decision: world.verdict ?? 'allow' }))
}
