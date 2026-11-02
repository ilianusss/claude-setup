---
name: changing-infrastructure
description: Changing infrastructure with Terraform, Kubernetes, Helm, Docker and CI - confirm the target, read the plan or diff before writing, summarize the change, ask before shared or production state, keep secrets out, and keep a rollback path. Use before terraform plan or apply, kubectl apply or delete, helm install or upgrade, a deploy, or editing Dockerfiles, charts, manifests or CI workflows.
---

# Changing infrastructure

Infrastructure commands act on shared state that has no undo button. Local targets (kind, minikube, docker compose, a local database) are fine without asking; everything else follows these steps.

## 1. Confirm the target

Before any command that reads or changes infrastructure, check and state where it would act:

| Tool | Check |
| --- | --- |
| kubectl, Helm | `kubectl config current-context`, the namespace (`kubectl config view --minify --output 'jsonpath={..namespace}'`), the Helm release (`helm list -n <namespace>`) |
| Terraform | `terraform workspace show`, the backend in use, the variables file |
| Cloud CLIs | `aws sts get-caller-identity`, `gcloud config list` |
| Docker | `docker context show` |

If the target is not the one the task names, stop and ask.

## 2. Read before writing

Run the dry form first and read its output:

- Terraform: `terraform plan -out=<file>`, then apply that file, never a fresh plan.
- Kubernetes: `kubectl diff -f <file>`, or `kubectl apply --dry-run=server -f <file>`.
- Helm: `helm diff upgrade` (plugin) or `helm template` compared with the live manifest, `helm upgrade --dry-run`.

Then summarize the change in a few lines: what is created, changed and destroyed, and anything replaced instead of updated in place (a replaced database or volume loses data).

## 3. Ask before shared or production state

`terraform apply`, `destroy`, `import`, `state`; `kubectl apply`, `delete`, `edit`, `patch`, `scale`, `rollout`; `helm install`, `upgrade`, `uninstall`, `rollback`; a deploy; a migration against a non-local database. Show the summary from step 2 with the question. `warden` already makes these commands ask; the summary is what makes the answer informed.

## 4. Keep secrets out

Never print a secret, a kubeconfig, Terraform state or a decoded Kubernetes secret: refer to it by name. Never `kubectl get secret -o yaml` or `terraform state show` on a resource holding credentials. Never write a secret into a values file, a manifest, a Dockerfile, a build argument or a CI log.

## 5. Keep a rollback path

Every change says how to undo it before it runs: the previous Helm revision, the previous image tag, a Terraform change that can be reverted without destroying data, a migration's down step or forward fix. A change with no rollback path is said so explicitly, and needs the user's explicit go.

## State and drift

- Terraform state is remote with locking. Never edit state by hand; `terraform state` commands are a last resort, with the user.
- When a plan shows changes nobody made in code, that is drift: report it before applying anything.
- Never `-lock=false` or `-target` to get past a problem without the user agreeing.

## Writing the files

- **Images:** pinned versions, a digest for production. A non-root user, multi-stage builds, lockfile installs (`npm ci`, `uv sync --frozen`). No secrets in layers or build arguments.
- **CI:** actions pinned to a commit SHA, least-privilege `permissions` on every workflow.
- **Kubernetes:** requests and limits, readiness and liveness probes, a `securityContext` (non-root, read-only root filesystem where possible). Never the `latest` tag.
- **Terraform:** remote state with locking, no hardcoded credentials, variables for anything that differs between environments.
