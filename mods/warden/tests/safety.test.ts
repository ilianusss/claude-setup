import { describe, expect, test } from 'claude-code/testing'

import { riskyReason } from '../src/safety'
import { engineBeneath } from './engine'

const RISKY = [
  'git reset --hard HEAD~1',
  'git clean -fd',
  'git branch -D old',
  'git branch --delete --force old',
  'terraform apply',
  'terraform destroy -auto-approve',
  'terraform state rm aws_s3_bucket.b',
  'tofu apply',
  'kubectl apply -f deploy.yaml',
  'kubectl -n prod delete pod api-1',
  'kubectl --context prod rollout restart deploy/api',
  'rtk kubectl apply -f deploy.yaml',
  'helm upgrade api ./chart',
  'helm uninstall api',
  'docker system prune -a',
  'docker volume rm data',
  'docker compose down -v',
  'gh pr merge 12 --squash',
  'gh release create v1.0.0',
  'gh repo delete me/x',
  'npm publish',
  'pnpm publish',
  'cargo publish',
  'dropdb app',
  'rm -rf build',
  'rm -fr build',
  'rm -r -f build',
  'rm --recursive --force build',
  'sudo rm -rf /tmp/x',
  'cat .env',
  'source .env',
  'cat app/.env.production',
  'docker run --env-file .env app',
  'cp ~/.ssh/id_ed25519 /tmp/k',
  'grep token ~/.kube/config',
  'cat ~/.aws/credentials',
  'cat infra/terraform.tfstate',
  'openssl x509 -in cert.pem',
  'cat certs/server.key',
  'env git reset --hard',
  'env -i PATH=/usr/bin git clean -fd',
  'env -u HOME git branch -D old',
  'bash -c "git reset --hard"',
  "sh -c 'rm -rf build'",
  'zsh -lc "terraform apply"',
  'git push --force origin main',
  'git push -f origin feat/x',
  'git push --force-with-lease',
  'git push origin +main',
  'rtk git push --force',
  'git -C ../other push --force',
]

const SAFE = [
  'git push',
  'git push -u origin feat/x',
  'rtk git push origin feat/x',
  'cd app && git push',
  'git -C ../other push',
  'git -c user.name=x push',
  'FOO=1 git push',
  'git status',
  'rtk git status',
  'git log --oneline -n5',
  'git diff HEAD',
  'git checkout -- src/a.ts',
  'git checkout main',
  'git restore src/a.ts',
  'git stash',
  'git stash pop',
  'git stash list',
  'git switch main',
  'git clean -n',
  'git branch -d merged',
  'rm notes.txt',
  'terraform plan',
  'terraform state list',
  'kubectl get pods -n prod',
  'kubectl rollout status deploy/api',
  'helm list -A',
  'helm template api ./chart',
  'docker compose down',
  'gh pr view 12',
  'gh pr list',
  'gh pr create --fill --draft',
  'gh pr edit 12 --add-reviewer me',
  'gh pr comment 12 --body ok',
  'gh pr review 12 --approve',
  'gh pr checkout 12',
  'gh pr checks 12',
  'gh pr diff 12',
  'gh pr ready 12',
  'gh pr close 12',
  'gh release list',
  'npm test',
  'echo "git push"',
  'grep -rn "rm -rf" scripts',
  'node -e "console.log(process.env.HOME)"',
  'grep -rn "process.env" src',
  'cat .env.example',
  'cp .env.example .env.sample',
  "jq '.key' data.json",
  'ls .venv',
  'echo $API_KEY',
  'env',
  'env NODE_ENV=test npm test',
  'bash scripts/build.sh',
  'bash -c "git status"',
]

describe('riskyReason', () => {
  for (const command of RISKY) {
    test(`asks for: ${command}`, () => {
      expect(riskyReason(command)).toBeDefined()
    })
  }

  for (const command of SAFE) {
    test(`stays quiet for: ${command}`, () => {
      expect(riskyReason(command)).toBeUndefined()
    })
  }
})

describe('the permission check', () => {
  test('a risky command the settings rules miss asks the person', async ($, on) => {
    engineBeneath(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git -C ../other reset --hard' } })
    expect(verdict).toMatchObject({ decision: 'ask' })
    expect(verdict.reason).toContain('git -C ../other reset --hard')
  })

  test('a safe command keeps the verdict from beneath', async ($, on) => {
    engineBeneath(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git status' } })
    expect(verdict.decision).toBe('allow')
  })

  test('rm -rf asks the person', async ($, on) => {
    engineBeneath(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
    expect(verdict).toMatchObject({ decision: 'ask' })
    expect(verdict.reason).toContain('rm -rf build')
  })

  test('reading a secret asks the person', async ($, on) => {
    engineBeneath(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'cat .env' } })
    expect(verdict).toMatchObject({ decision: 'ask' })
    expect(verdict.reason).toContain('cat .env')
  })

  test('git push keeps the verdict from beneath', async ($, on) => {
    engineBeneath(on)
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })
    expect(verdict.decision).toBe('allow')
  })

  test('a deny from beneath stays a deny', async ($, on) => {
    engineBeneath(on, { verdict: 'deny' })
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git push' } })
    expect(verdict.decision).toBe('deny')
  })
})

const TERMINAL = { isFullscreen: false, columns: 80 }

describe('the /safety command', () => {
  test('typed at the prompt, it turns the asks off', async ($, on) => {
    engineBeneath(on)
    const ran = await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    expect(ran.text).toContain('off')
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'terraform apply' } })
    expect(verdict.decision).toBe('allow')
  })

  test('typed a second time, it turns the asks back on', async ($, on) => {
    engineBeneath(on)
    await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    const ran = await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    expect(ran.text).toContain('back on')
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'terraform apply' } })
    expect(verdict).toMatchObject({ decision: 'ask' })
  })

  test('run by a plugin in the person\'s name, it leaves the asks on', async ($, on) => {
    engineBeneath(on)
    const origin = { kind: 'plugin', name: 'other', asUser: true } as const
    const ran = await $.command.run({ command: 'safety', args: '', origin, presentation: TERMINAL })
    expect(ran.text).toContain('typed at the prompt')
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'terraform apply' } })
    expect(verdict).toMatchObject({ decision: 'ask' })
  })

  const LIFTED = [
    'kubectl delete pod api',
    'helm upgrade api ./chart',
    'tofu destroy',
    'docker system prune -af',
    'npm publish',
    'git push --force',
    'git push -f origin feat/x',
    'git push --force-with-lease',
  ]

  for (const command of LIFTED) {
    test(`while it is off, lets through: ${command}`, async ($, on) => {
      engineBeneath(on)
      await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
      const verdict = await $.tool.check({ tool: 'Bash', input: { command } })
      expect(verdict.decision).toBe('allow')
    })
  }

  const STILL_ASKED = [
    { command: 'git reset --hard HEAD~1' },
    { command: 'git clean -fd' },
    { command: 'gh pr merge 12' },
    { command: 'dropdb app' },
    { command: 'terraform apply && git branch -D old' },
    { command: 'rm -rf build' },
    { command: 'kubectl --kubeconfig .kube/config get pods' },
  ]

  for (const input of STILL_ASKED) {
    test(`while it is off, still asks for: ${input.command}`, async ($, on) => {
      engineBeneath(on)
      await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
      const verdict = await $.tool.check({ tool: 'Bash', input })
      expect(verdict).toMatchObject({ decision: 'ask' })
    })
  }

  test('an interactive session lists it', async ($, on) => {
    engineBeneath(on)
    const registered: string[] = []
    on('command.register', (_, e) => {
      registered.push(e.name)
      return { value: { command: e.name } }
    })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(registered).toEqual(['safety'])
  })

  test('a reload while it is off shows the status line again', async ($, on) => {
    engineBeneath(on)
    on('command.register', (_, e) => ({ value: { command: e.name } }))
    const shown: (string | undefined)[] = []
    on('ui.status', (_, e) => {
      shown.push(e.text)
      return { value: undefined }
    })
    await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    expect(shown).toEqual(['warden: safety off', 'warden: safety off'])
  })

  test('while the asks are off, the status line says so', async ($, on) => {
    engineBeneath(on)
    const shown: (string | undefined)[] = []
    on('ui.status', (_, e) => {
      shown.push(e.text)
      return { value: undefined }
    })
    await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    expect(shown).toEqual(['warden: safety off', undefined])
  })
})

describe('/safety replies', () => {
  test('leave the plugin prefix to Claude Code, which adds it to every reply', async ($, on) => {
    engineBeneath(on)
    const typed = await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    const again = await $.command.run({ command: 'safety', args: '', origin: { kind: 'composer' }, presentation: TERMINAL })
    const relayed = await $.command.run({ command: 'safety', args: '', origin: { kind: 'plugin', name: 'other', asUser: true }, presentation: TERMINAL })
    for (const ran of [typed, again, relayed]) expect(ran.text).not.toMatch(/^warden:/)
  })
})
