# Google-Planilhas

Editor de planilhas que roda no navegador, sem instalação e sem servidor, no estilo do Google Planilhas.
Interface em preto, branco e vermelho.

## Como abrir

Não precisa de build. Basta abrir `index.html` em um navegador moderno (Chrome, Edge, Firefox ou Safari).

Para testar com um servidor local (recomendado, para evitar restrições de `file://`):

```sh
python3 -m http.server 8080
# depois abra http://localhost:8080
```

Os dados são salvos automaticamente no navegador (localStorage). Use **Arquivo → Baixar backup (.json)** para guardar uma cópia.

## Estrutura

```
index.html        página principal (menus, barra de ferramentas, grade, abas, diálogos)
src/styles.css    estilos; cores da marca em :root (--red, --black, --white)
src/engine.js     motor de cálculo: referências, operadores, funções e erros (#DIV/0!, #REF!, #CIRC!...)
src/app.js        estado do documento, grade virtualizada, seleção, edição, desfazer/refazer
src/io.js         arquivos (CSV/JSON), localizar, ordenação, gráficos, planilhas (abas), impressão
src/features.js   menus, barra de ferramentas, formatação, copiar/recortar/colar, alça de preenchimento, atalhos
assets/favicon.svg
```

## Recursos

- **Grade:** 52 colunas (A a AZ) × 1.000 linhas, com rolagem virtualizada; redimensionar colunas e linhas arrastando o cabeçalho; zoom de 75% a 150%; mostrar/ocultar linhas de grade.
- **Seleção:** clique, arrastar, Shift+clique, Shift+setas, Ctrl+setas (salta até o limite dos dados), seleção de linha e coluna pelos cabeçalhos, Ctrl+A.
- **Edição:** digitar direto na célula, F2, barra de fórmulas, caixa de nome (ex.: `B2` ou `A1:C9`), Enter/Tab com retorno à coluna de origem, Esc para cancelar.
- **Fórmulas:** operadores `+ - * / ^ & % = <> < > <= >=`; referências relativas e absolutas; intervalos; ~50 funções com nomes em português e inglês (SOMA, MÉDIA, MÁXIMO, MÍNIMO, CONT.NÚM, CONT.SE, SOMASE, SE, SEERRO, PROCV, PROCH, ARRED, CONCATENAR, ESQUERDA, DIREITA, MAIUSC, HOJE, DATA, E, OU, NÃO...).
  - Em pt-BR, use `;` para separar argumentos e `,` como separador decimal (ex.: `=ARRED(2,345;2)`).
- **Formatação:** negrito, itálico, sublinhado, tachado, fonte, tamanho, cor do texto, cor de preenchimento, alinhamento, quebra de texto, bordas, formatos de número, moeda (R$), porcentagem, data, casas decimais.
- **Edição em massa:** copiar/recortar/colar (com ajuste automático das referências), alça de preenchimento (repete valores ou continua séries numéricas), Delete para limpar.
- **Dados:** ordenar intervalo A→Z e Z→A; soma automática (Σ); barra de status com soma, média e contagem da seleção.
- **Localizar:** Ctrl+F, com destaque dos resultados e navegação entre eles.
- **Gráficos:** colunas, linhas e pizza a partir de um intervalo (desenhados em SVG).
- **Planilhas (abas):** adicionar, renomear (duplo clique), duplicar, excluir.
- **Arquivos:** abrir/baixar `.json` (backup completo) e `.csv`; imprimir (Ctrl+P).
- **Histórico:** desfazer (Ctrl+Z) e refazer (Ctrl+Y).

## Atalhos

| Atalho | Ação |
|---|---|
| Enter / Shift+Enter | Confirmar e descer / subir |
| Tab / Shift+Tab | Confirmar e ir para a direita / esquerda |
| F2 | Editar célula |
| Delete / Backspace | Limpar conteúdo |
| Ctrl+C, Ctrl+X, Ctrl+V | Copiar, recortar, colar |
| Ctrl+Z / Ctrl+Y | Desfazer / refazer |
| Ctrl+B, Ctrl+I, Ctrl+U | Negrito, itálico, sublinhado |
| Ctrl+S | Salvar no navegador |
| Ctrl+F | Localizar |
| Ctrl+P | Imprimir |
| Ctrl+A | Selecionar tudo |

## Limitações conhecidas

- Não há colaboração em tempo real nem contas de usuário: os dados ficam no navegador de quem editou.
- Gráficos são exibidos em janela; ainda não são objetos flutuantes dentro da planilha.
- Não há congelar painéis, filtros, validação de dados, formatação condicional, tabelas dinâmicas, comentários, imagens e macros.
- Não há inserir/excluir linhas e colunas no meio da planilha.
- Importação e exportação `.xlsx` não estão implementadas (use CSV ou JSON).
- A quantidade de linhas e colunas é fixa (1.000 × 52).
- Ordenar intervalos não reajusta referências de fórmulas que apontam para linhas movidas.

## Logo e cores

A cor de destaque está em `src/styles.css` (`--red`, `--red-dark`, `--black`). O logotipo do topo está em `index.html` (símbolo `#i-logo`) e em `assets/favicon.svg`. Para usar a logo oficial da empresa, substitua o SVG por ela.
