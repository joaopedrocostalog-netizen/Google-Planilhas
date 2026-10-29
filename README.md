# Google-Planilhas

Editor de planilhas que roda inteiro no navegador, no estilo do Google Planilhas, com interface em preto, branco e vermelho.
Não tem servidor nem etapa de build: são arquivos estáticos (HTML, CSS e JavaScript), prontos para o GitHub Pages.

## Como publicar no GitHub Pages

1. No repositório, abra **Settings → Pages**.
2. Em *Build and deployment*, escolha **Deploy from a branch**, selecione a branch (`main` ou `planilhas-web`) e a pasta **/ (root)**.
3. Clique em **Save**. O site fica em `https://<usuário>.github.io/Google-Planilhas/`.

Para testar localmente:

```sh
python3 -m http.server 8080
# abra http://localhost:8080
```

## Recursos

**Interface no estilo do Google Planilhas**
- Barra de menus completa (Arquivo, Editar, Ver, Inserir, Formatar, Dados, Ferramentas, Extensões, Ajuda), com submenus e atalhos.
- Barra de ferramentas na mesma ordem do Sheets, busca nos menus (Alt+/), barra de fórmulas com caixa de nome.
- Grade desenhada em canvas: linhas e colunas congeladas, texto que transborda para células vazias, mesclagem, bordas, rotação, quebra de texto com ajuste automático de altura.
- Abas de página: adicionar, renomear (duplo clique), arrastar para reordenar, cores, ocultar, duplicar.
- Resumo da seleção no rodapé (soma, média, mínimo, máximo, contagem).
- Menus de contexto na célula, nos cabeçalhos e nas abas.

**Fórmulas**
- 184 funções, com nomes em português e em inglês (SOMA/SUM, PROCV/VLOOKUP, PROCX/XLOOKUP, SE/IF, SOMASES, CONT.SES, ÍNDICE, CORRESP, FILTER, CLASSIFICAR, ÚNICO, SEQUÊNCIA, TEXTO, DATADIF, PGTO, REGEXEXTRACT…).
- Matrizes que transbordam para as células vizinhas (FILTER, ÚNICO, SEQUÊNCIA, ARRAYFORMULA, `={1\2;3\4}`), com `#REF!` quando há dados no caminho.
- Referências entre páginas (`Página2!A1`, `'Minha página'!A1:B5`), colunas e linhas inteiras (`A:A`, `2:2`), intervalos abertos (`A2:B`) e intervalos nomeados.
- Referências coloridas no editor, modo apontar (clique, arraste ou use as setas para inserir referências, inclusive de outras páginas), autocompletar de funções, ajuda de argumentos e F4 para `$`.
- Erros com explicação ao passar o mouse (`#DIV/0!`, `#N/A`, `#REF!`, `#NAME?`, dependência circular).
- Em pt-BR: argumentos separados por `;` e vírgula decimal (`=ARRED(2,345;2)`).

**Formatação**
- Negrito, itálico, sublinhado, tachado, fonte, tamanho, cores, alinhamento horizontal e vertical, quebra de texto, rotação, recuo, bordas (estilos e cores).
- Formatos: automático, número, porcentagem, científico, contábil, financeiro, moeda (R$), data, hora, duração e formatos personalizados (`#,##0.00`, `dd/mm/aaaa`, `[h]:mm:ss`…).
- Formatos automáticos ao digitar (datas, %, R$) e herança de formato em fórmulas (como `=HOJE()` ou `=SOMA()` de valores em reais).
- Pintar formatação, formatação condicional (cor única e escala de cores), cores alternadas.

**Dados**
- Filtros por valores e por condição, classificação de página e de intervalo (inclusive com várias colunas e cabeçalho).
- Validação de dados: lista suspensa com chips coloridos, lista de um intervalo, caixas de seleção, número, texto e data.
- Tabela dinâmica (com fórmulas que se atualizam sozinhas), estatísticas da coluna, remover cópias, cortar espaços, dividir texto em colunas.
- Inserir, excluir, ocultar e redimensionar linhas e colunas, com ajuste automático das fórmulas.

**Edição**
- Copiar, recortar e colar (inclusive de/para Excel e Google Planilhas), colar especial (valores, formatação, fórmulas, transposto).
- Alça de preenchimento com séries (números, datas, meses, dias da semana, "Item 1, Item 2…"), Ctrl+D e Ctrl+R.
- Localizar (Ctrl+F) e localizar e substituir (Ctrl+H) com expressões regulares.
- Notas, comentários, links (inclusive para outras páginas).
- Desfazer e refazer ilimitados na sessão, histórico de versões no navegador.

**Gráficos**
- Colunas, colunas empilhadas, barras, linhas, área, pizza, rosca e dispersão.
- Gráficos flutuantes: mover, redimensionar, editar no painel lateral e baixar como PNG ou SVG.
- Minigráficos na célula com SPARKLINE (linha, colunas, barra, ganho/perda), imagens na célula com IMAGEM(url) e imagens sobre as células (Inserir › Imagem).

**Arquivos**
- Várias planilhas salvas no navegador (Arquivo › Abrir), fazer uma cópia, nova planilha.
- Importar e baixar `.xlsx`, `.csv`, `.tsv`, `.json`; abrir também `.xls` e `.ods`; baixar como página da web; imprimir/PDF.
- Arrastar um arquivo para a janela abre como nova planilha.
- Compartilhar por link: os dados vão compactados no endereço e quem abre recebe uma cópia.

## Atalhos principais

| Atalho | Ação |
|---|---|
| Ctrl+Z / Ctrl+Y | Desfazer / refazer |
| Ctrl+C / Ctrl+X / Ctrl+V | Copiar / recortar / colar |
| Ctrl+Shift+V | Colar somente valores |
| Ctrl+B / I / U | Negrito / itálico / sublinhado |
| Ctrl+Shift+1…6 | Número, hora, data, moeda, porcentagem, científico |
| Ctrl+F / Ctrl+H | Localizar / substituir |
| Ctrl+K | Inserir link |
| Shift+F2 / Ctrl+Alt+M | Nota / comentário |
| Ctrl+; | Inserir data |
| Ctrl+D / Ctrl+R | Preencher para baixo / direita |
| Ctrl+Alt+= / Ctrl+Alt+- | Inserir / excluir linhas ou colunas |
| Alt+Enter | Nova linha dentro da célula |
| F4 | Alternar referência absoluta |
| Alt+/ | Pesquisar nos menus |
| Ctrl+/ | Todos os atalhos |

## Estrutura

```
index.html          estrutura da página
src/styles.css      tema (cores da marca em :root: --red, --black, --white)
src/engine.js       tokenizador, parser, avaliador, pasta de trabalho, reescrita de fórmulas
src/functions.js    funções: matemática, estatística, lógica, busca, matrizes
src/functions2.js   funções: texto, data, informações, finanças; formatador de números
src/model.js        documento, histórico, persistência, operações estruturais, filtros, validação
src/grid.js         grade em canvas, seleção, mouse, rolagem
src/editor.js       editor de célula e barra de fórmulas
src/commands.js     comandos, atalhos de teclado, área de transferência
src/chrome.js       menus, barra de ferramentas, paleta, caixa de nome, busca nos menus
src/chrome2.js      abas, avisos, diálogos, dicas, menus de contexto, filtro
src/panels.js       painéis laterais (formatação condicional, validação, tabela dinâmica…)
src/dialogs.js      localizar e substituir, link, nota, comentário, lista de funções…
src/charts.js       gráficos
src/io.js           arquivos, impressão e compartilhamento
src/app.js          inicialização
tests/              testes do motor (node tests/engine.test.js)
```

## Limitações

- Sem colaboração em tempo real nem contas: cada pessoa edita a própria cópia, salva no navegador.
- O `.xlsx` exportado leva valores, fórmulas, formatos de número, mesclagens, larguras e notas, mas não cores e fontes (limite da biblioteca SheetJS gratuita).
- Não há Apps Script, macros, GOOGLEFINANCE, IMPORTRANGE nem QUERY.

## Logo e cores

As cores ficam em `src/styles.css` (`--red`, `--red-dark`, `--black`). O logotipo está em `index.html` (dentro de `.app-logo`) e em `assets/favicon.svg`. Para usar a logo oficial da empresa, troque esses SVGs.
