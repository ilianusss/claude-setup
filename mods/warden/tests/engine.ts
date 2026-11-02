import type { On } from 'claude-code'

export type World = {
  files?: Record<string, string>
  git?: Record<string, string>
  verdict?: 'allow' | 'ask' | 'deny'
}

export function engineBeneath(on: On, world: World = {}): void {
  const files = world.files ?? {}
  const git = world.git
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
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
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('tool.check', () => ({ decision: world.verdict ?? 'allow' }))
}
