# Command: SPECIFY (fase 1 do SDD)

> Pilar 1 - Spec-Driven Execution

Voce esta na fase **SPECIFY** do Spec-Driven Development. Sua unica funcao agora e produzir uma SPEC clara, verificavel e completa para a tarefa.

**NAO escreva codigo nesta fase.** Codigo vem depois, em EXECUTE.

## Tarefa

`$ARGUMENTS`

## Output obrigatorio

Crie o arquivo `$ARTIFACTS_DIR/spec.md` com a estrutura abaixo (Markdown):

```markdown
# Spec: <titulo curto da tarefa>

## Contexto

<2-4 linhas explicando POR QUE a tarefa existe>
<Referencia: task no Teamwork #NNNN se aplicavel>

## Objetivo

<1-2 linhas: o que vai estar diferente quando a tarefa estiver pronta>

## Escopo

### In scope
- <item 1>
- <item 2>
- <item 3>

### Out of scope
- <item 1>
- <item 2>

## Criterios de aceite

Cada criterio DEVE ser verificavel objetivamente (teste-able ou observavel).

1. **Dado** <condicao inicial>, **quando** <acao>, **entao** <resultado esperado>
2. **Dado** <condicao inicial>, **quando** <acao>, **entao** <resultado esperado>
3. **Dado** <condicao inicial>, **quando** <acao>, **entao** <resultado esperado>

## Edge cases / Erros

- <caso 1>: comportamento esperado
- <caso 2>: comportamento esperado
- <input invalido>: comportamento esperado

## Dependencias / Pre-condicoes

- <sistema/biblioteca/dado/permissao necessaria>
- <variavel de ambiente / config>

## Rollback

Se essa tarefa for revertida:
- <o que precisa ser desfeito>
- <impacto em dados em transito>

## Nao-funcionais (se aplicavel)

- Performance: <SLA ou expectativa>
- Seguranca: <consideracoes>
- Compatibilidade: <versoes/clientes>
```

## Regras obrigatorias

1. **Tudo verificavel.** Nada de "deve funcionar bem" — tem que ser testavel.
2. **Edge cases primeiro.** Bug nasce no que voce nao listou.
3. **Maximo 1 pagina.** Se voce passa de 80 linhas, esta especificando codigo, nao escopo.
4. **Sem tecnologia.** A spec descreve COMPORTAMENTO, nao implementacao. "Usar Redis" e DESIGN, nao SPEC.
5. **Inclua rollback.** Se nao da pra desfazer, nao deveria ter sido feito.

## Apos escrever

Salve em `$ARTIFACTS_DIR/spec.md`.
Depois pare. O Judge proximo node vai avaliar.

> A spec e o gabarito do design. O design e o gabarito das tarefas. As tarefas sao o gabarito da execucao. Se voce errar aqui, tudo depois fica torto.
