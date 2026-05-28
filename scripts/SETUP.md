# Setup do Harness — do zero ao primeiro `archon workflow run`

Sequencia testada em Windows 11. Tempo estimado: 5-10 min.

## Pre-requisitos

- Git for Windows (com Git Bash)
- VSCode + Claude Code (autenticado, Pro Max recomendado)
- PowerShell 5.1+

## Passos

### 1. Bun (~80 MB download)

```powershell
irm bun.sh/install.ps1 | iex
# Ou se ja tem em outro path, garanta version >= 1.3.0
bun --version
```

Em alguns ambientes (incluindo este projeto) o bun vai pra
`C:\Users\<voce>\AppData\Local\reflex\bun\bin\bun.exe`. Outros tem em
`%USERPROFILE%\.bun\bin\bun.exe`. **Funciona qualquer um.**

### 2. Archon CLI binario

```powershell
irm https://archon.diy/install.ps1 | iex
```

Instala em `%USERPROFILE%\.archon\bin\archon.exe` e adiciona ao PATH.

**Reinicie o terminal** pra PATH atualizar. Verifica:

```powershell
archon --version    # esperando: Archon CLI v0.3.x
```

Se o `archon` nao for reconhecido na mesma sessao:

```powershell
$env:PATH = [Environment]::GetEnvironmentVariable("PATH","User") + ";" + [Environment]::GetEnvironmentVariable("PATH","Machine")
archon --version
```

### 3. Bun local pro projeto

O bash que Archon spawna em alguns ambientes nao acha `bun` no PATH.
Workaround: copia bun.exe pra dentro do projeto.

```powershell
cd d:\Prototipos\SemanaIA
$bun = (Get-Command bun.exe).Path
New-Item -ItemType Directory -Force -Path ".archon/bin" | Out-Null
Copy-Item $bun ".archon/bin/bun.exe"
```

Os workflows ja referenciam `.archon/bin/bun.exe`.

### 4. Validar

```powershell
archon workflow list           # esperando 23+ workflows
archon doctor                  # esperando "All checks passed"
```

### 5. Primeiro run (smoke test)

```powershell
archon workflow run sdd-task --no-worktree "criar funcao validar_documento"
```

Espera-se:
- `identity_log` ok
- `cost_cap_init` ok
- `auto_size` classifica complexidade
- `specify` escreve spec.md em `.archon/artifacts/runs/<run-id>/`
- `judge_specify` aprova com score
- Workflow `completed successfully`

Verifica eventos:

```powershell
Get-Content events/*.jsonl | ConvertFrom-Json | Format-Table ts,event,phase,score
```

Verifica custo:

```powershell
Get-Content .archon/state/cost.json | ConvertFrom-Json | Select-Object -ExpandProperty runs
```

## Em caso de problemas

| Sintoma | Fix |
|---|---|
| `bun: command not found` no bash node | Copie bun.exe pra `.archon/bin/` (passo 3) |
| `cmd: command not found` | Idem — use path relativo no workflow |
| `bun.exe: No such file` (file existe) | Bash do Archon nao acha. Use `.archon/bin/bun.exe` |
| `Cannot detect default branch` | Adicione `worktree.baseBranch: main` em `.archon/config.yaml` |
| `Sync fetch from origin/main failed` | Use flag `--no-worktree` ou configure git remote |
| Config YAML parse error | Cheque espacos antes de `#` em comentarios inline |

## Backup / Restore dos binarios

Os binarios (~215 MB total) nao vao pro git. Backup outside repo:

```powershell
.\scripts\backup-harness-deps.ps1     # salva em d:/tmp/harness-deps-backup-<data>/
.\scripts\restore-harness-deps.ps1    # restaura ou reinstala
```

Atualize periodicamente:

```powershell
bun upgrade
irm https://archon.diy/install.ps1 | iex    # atualiza archon
.\scripts\backup-harness-deps.ps1            # novo snapshot
```

## Arquitetura do que voce acabou de instalar

```
d:\Prototipos\SemanaIA\                    <- projeto
+-- .archon/
|   +-- bin/
|   |   +-- bun.exe (94 MB, gitignored)
|   +-- workflows/
|   |   +-- sdd-task.yaml, fix-bug.yaml, pr-review.yaml
|   +-- scripts/
|   |   +-- cost_cap.ts, judge.ts, etc
|   +-- commands/
|       +-- specify.md, design.md, ...
+-- harness/                                <- referencia/templates
+-- events/                                 <- runtime, gitignored
+-- lessons/                                <- Cognition Lessons

C:\Users\<voce>\.archon\
+-- bin/
|   +-- archon.exe (121 MB, global, na PATH)
+-- archon.db (sqlite local)
+-- workspaces/_local/...                   <- artifacts por projeto

d:\tmp\harness-deps-backup-<data>/          <- backup binarios
+-- bun.exe + archon.exe + VERSIONS.txt
```

## Sobre o `archon.cmd` wrapper

Existe em `d:\Prototipos\SemanaIA\archon.cmd` mas e legado de quando rodava
do source clonado. Com binario instalado, use `archon` direto.

Pode deletar o `archon.cmd` se quiser:

```powershell
Remove-Item archon.cmd, archon.ps1
```
