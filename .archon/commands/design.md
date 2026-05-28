# Command: DESIGN (fase 2 do SDD)

> Pilar 1 - Spec-Driven Execution

Voce esta na fase **DESIGN**. Sua funcao e traduzir a SPEC em um plano TECNICO executavel.

**NAO escreva codigo nesta fase.** Codigo vem em EXECUTE.

## Inputs

- Spec: `$ARTIFACTS_DIR/spec.md` (FROZEN — nao alterar)
- Tarefa: `$ARGUMENTS`

## Output obrigatorio

Crie o arquivo `$ARTIFACTS_DIR/design.md` com a estrutura abaixo (Markdown):

```markdown
# Design: <titulo da tarefa>

## Resumo

<3-5 linhas: estrategia tecnica de alto nivel, decisoes-chave>

## Stack envolvida

- Linguagens/frameworks: <lista>
- Modulos/camadas afetadas: <lista>
- Integracao externa: <lista, se houver>

## Decisoes tecnicas

### <Decisao 1: titulo curto>
- **Opcao escolhida:** <descricao>
- **Trade-off:** <o que perdemos / ganhamos>
- **Alternativa descartada:** <opcao B, e por que nao>

### <Decisao 2>
...

## Estrutura de arquivos

Liste arquivos a CRIAR, MODIFICAR ou REMOVER, com 1 linha do "por que":

- CRIAR `path/to/NewFile.java` — <funcao>
- MODIFICAR `path/to/Existing.java` — <natureza da mudanca>
- REMOVER `path/to/Dead.java` — <razao>

## Contratos / Interfaces

Para cada interface publica nova ou alterada:

```typescript
// ou Java, ou TS, ou pseudo-codigo
interface Foo {
  bar(x: int): Result;
}
```

## Fluxo principal

1. <passo>
2. <passo>
3. <passo>

Inclua tratamento de erro e edge cases relevantes da spec.

## Testes minimos

Liste os testes que cobrem os criterios de aceite da spec:

- `TestClass.shouldDoX_whenY()` — cobre criterio 1
- `TestClass.shouldFail_whenInvalidInput()` — cobre edge case 1
- ...

## Riscos

- **<Risco 1>:** <mitigacao>
- **<Risco 2>:** <mitigacao>

## Estimativa de esforco

- Linhas: ~<N>
- Complexidade: <trivial|small|medium|large>
- Tempo agente: <minutos>
```

## Regras obrigatorias

1. **Cobre 100% dos criterios da spec.** Se um criterio nao vira teste, voltar pra spec.
2. **Decisoes explicitas.** Toda escolha tecnica vem com trade-off documentado.
3. **Arquivos especificos.** Nada de "varios lugares" — liste path por path.
4. **Sem codigo final.** Pseudocodigo OK; implementacao real fica pra EXECUTE.
5. **Maximo 2 paginas.** Se passa de 150 linhas, esta especificando demais.

## Casos especiais

- **Tarefa SMALL (auto-size):** design enxuto, 1 pagina. Foco em "qual arquivo, que predicate, qual teste".
- **Tarefa MEDIUM/LARGE:** design completo, com riscos e alternativas.
- **Bug fix sem mudanca arquitetural:** descreva apenas a regiao alterada + teste de regressao.

## Apos escrever

Salve em `$ARTIFACTS_DIR/design.md`.
Depois pare. O Judge proximo node vai avaliar.

> O design e o gabarito das tarefas. Se voce omite decisoes aqui, o executor inventa as proprias — e a probabilidade de errar dispara.
