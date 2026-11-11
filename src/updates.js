// Ajuda › Últimas atualizações: tudo o que mudou na planilha, por data, explicado de um jeito simples.
(function (App) {
  'use strict';
  const esc = App.esc;
  // a mais nova primeiro; cada item: [área, o que mudou]
  const UPDATES = [
    { date: '11/11/2026', title: 'PRÉ STACKING protegido, CNH na escala, painéis por aba e aviso do AGENDAMENTO', items: [
      ['Linhas protegidas', 'No PRÉ STACKING, apagar (Delete) ou sobrescrever (colar, Ctrl+D, arrastar) uma linha vinculada ao MAPA não acontece sem confirmar: a linha volta na hora e aparece a pergunta. Com Sim, a mudança vale e a marca P.S. no MAPA é retirada; com Não, fica como estava.'],
      ['Cópias', 'Copiar uma linha vinculada (Ctrl+D, colar) não copia o vínculo; no MAPA, a cópia da caixa P.S. vem desmarcada, com aviso.'],
      ['CNH', 'Com a escala não confirmada no PRÉ STACKING, a CNH também fica em vermelho até confirmar (e pisca em azul no pedido de troca).'],
      ['Painéis', 'Validação de dados e formatação condicional mostram a página no topo e mudam junto com a aba. A regra que estava em edição numa aba abre de novo quando você volta para ela.'],
      ['AGENDAMENTO', 'Entrada recusada abre a janela "AGENDAMENTO fora do formato padrão", explicando que precisa estar em dd/mm/aaaa hh:mm, com exemplo e o que foi recusado. Corrigido o erro que mostrava só "não foi possível concluir a atualização automática".'],
      ['Modo escuro', 'Os números das linhas, as letras das colunas e a faixa dos agrupamentos acompanham o modo escuro; as células continuam claras.'],
    ] },
    { date: '11/11/2026', title: 'PRÉ STACKING: abas da escala pela OBS, aviso de cancelamento e posição da linha nova', items: [
      ['Escala no PRÉ STACKING', 'Em PRÉ STACKING CHEIO e VAZIO, as abas da escala de frota são os valores da coluna OBS da BASE GERAL (no lugar de Rodotrem, CONVENC. L, CONVENC. LS…).'],
      ['Cancelamento', 'O aviso "Confirmar que vi" volta toda vez que alguém clica no STATUS da linha que pisca, até ser confirmado. A confirmação agora vale também para quem só visualiza algumas colunas (antes o aviso sumia e a linha continuava piscando).'],
      ['Linhas vazias piscando', 'Linha sem informação nenhuma para de piscar sozinha.'],
      ['Linha nova', 'Ao marcar P.S. CH / P.S. VZ, a linha entra 2 linhas depois da última com STATUS (ou com os dados que a marcação preenche). Caixas de seleção desmarcadas e textos perdidos em outras colunas não empurram mais a linha para baixo.'],
    ] },
    { date: '11/11/2026', title: 'Atalhos, AGENDAMENTO do PRÉ STACKING, cancelamento, escala e cidades', items: [
      ['Atalhos', 'Ctrl+Alt+V (colar só a formatação) e Ctrl+Shift+7 (borda externa) voltaram a funcionar. Todos os atalhos de Ajuda › Atalhos do teclado foram conferidos.'],
      ['AGENDAMENTO', 'No PRÉ STACKING CHEIO e VAZIO, a coluna AGENDAMENTO só aceita data e hora no formato dd/mm/aaaa hh:mm (ex.: 06/11/2026 14:30). Outro formato volta como estava, com aviso.'],
      ['Cancelamento', 'No MAPA, a marca P.S. CH / P.S. VZ não pode ser retirada se o PRÉ STACKING já estiver FINALIZADO. Se ainda não estiver, o STATUS do PRÉ STACKING vira CANCELADO e a linha pisca em vermelho até alguém confirmar que viu (a confirmação fica no histórico de cada célula).'],
      ['Escala no PRÉ STACKING', 'Escalar veículo no PRÉ STACKING CHEIO e VAZIO usa a BASE GERAL (CAVALO, CARRETA, MOTORISTA, CPF, CNH), com as mesmas regras e cores da escala do MAPA. O status da placa vem da coluna OBS (também no balão do cavalo).'],
      ['Cidades', 'Terminais e depots mostram a cidade ao clicar e na lista de seleção também no MAPA EXPO (ENTREGA e RETIRADA) e no TERMINAL do PRÉ STACKING CHEIO e VAZIO.'],
      ['CONTAINER', 'O CONTAINER só muda do MAPA para o PRÉ STACKING; mudar no PRÉ STACKING não altera o MAPA.'],
      ['Modo escuro', 'As células da planilha continuam claras no modo escuro (só menus, barras e janelas ficam escuros).'],
    ] },
    { date: '11/11/2026', title: 'Botão do modo escuro no cabeçalho', items: [
      ['Modo escuro', 'O botão de lua no cabeçalho liga o modo escuro; o de sol volta ao claro. Fica guardado neste aparelho. O modo Automático (segue o aparelho) continua em Ver › Tema.'],
    ] },
    { date: '10/11/2026', title: 'Notificações obrigatórias, mensagem de administrador em destaque e versões a cada 3 horas', items: [
      ['Notificações', 'Agora são obrigatórias: ao entrar na conta, a planilha só abre depois de ativar as notificações do aparelho, e não há mais como desligar: todos os avisos ficam ligados (a lista está em Ferramentas › Notificações).'],
      ['Computador', 'Os avisos aparecem como notificação do sistema, por cima de qualquer janela, com a planilha na tela ou não, e ficam até você clicar ou fechar.'],
      ['Mensagem de administrador', 'Chega em destaque no chat e no meio da tela (fica até responder ou fechar) e vira notificação na hora, sem esperar para juntar com outras.'],
      ['Histórico de versões', 'A versão automática passou de 30 minutos para 3 horas e só é guardada quando alguém alterou a planilha.'],
    ] },
    { date: '09/11/2026', title: 'Servidor no Railway', items: [
      ['Servidor', 'O servidor da planilha passou da Render para o Railway. A conexão com o banco interno do Railway agora funciona sem travar na tela de conexão.'],
      ['Dados', 'Contas, senhas, planilhas, histórico, versões e mensagens são copiados do banco antigo para o novo de uma vez só, na subida do servidor. Quem já estava conectado continua conectado.'],
    ] },
    { date: '06/11/2026', title: 'Autocompletar na coluna e histórico de alterações da planilha', items: [
      ['Autocompletar', 'Ao digitar numa célula, aparecem os textos já usados na mesma coluna (os mais usados primeiro, sem diferença de acento ou maiúscula). Enter grava o que você digitou; para usar uma sugestão, desça com a seta, aperte Tab ou clique nela.'],
      ['Histórico de alterações', 'Administrador › "Histórico de alterações da planilha": cada célula alterada, por quem e quando, com o antes e o depois. Filtros por pessoa, página, período e texto; clique numa linha para ir até a célula.'],
    ] },
    { date: '06/11/2026', title: 'Planilha mais rápida (servidor e tela)', items: [
      ['Entrar na planilha', 'A planilha agora viaja compactada entre o servidor e o navegador (cerca de 25 vezes menor), o que ajuda principalmente no celular e quando todos reconectam depois de uma atualização.'],
      ['Digitar', 'Cada edição ficou cerca de duas vezes mais leve: a tela compara só o texto de cada célula, sem refazer uma cópia da planilha inteira a cada Enter. Rolar e receber edições de outras pessoas também ficaram mais leves.'],
      ['Servidor', 'Cada edição é convertida e enviada uma vez para todos (antes era uma vez por pessoa), a planilha já pronta é reaproveitada por quem entra em seguida e o histórico das células é gravado em lotes. O servidor gasta cerca de 40% menos por edição e 70% menos quando várias pessoas entram juntas.'],
    ] },
    { date: '06/11/2026', title: 'Demurrage, alertas no celular, status automático, histórico do container e mais', items: [
      ['Demurrage', 'No PRÉ STACKING VAZIO, CONTAINER, DATA BAIXA e DEMMURAGE ficam amarelos quando o prazo (DATA BAIXA + DEMMURAGE) vence em até 2 dias e vermelhos quando venceu. Entra sozinho no botão ALERTA e avisa no celular.'],
      ['Alertas no celular', 'As regras do botão ALERTA também viram notificação. Em Notificações no celular, "Exemplo de cada aviso" manda um exemplo de cada tipo.'],
      ['Status automático', 'Administrador › Status automático por e-mail: aba, linhas (CLIENTE, REFERENCIA…), STATUS que ficam de fora, horários, dias e quem confere. Na hora, o setor recebe o aviso e confere no Painel do dia; o e-mail só sai depois de confirmar.'],
      ['Histórico do container', 'Botão direito no container › Histórico do container (ou Ferramentas): ficha das linhas atuais e linha do tempo de tudo o que mudou. Em Personalizar, escolha campos, colunas e pessoas e oculte itens um a um. Dá para imprimir.'],
      ['Registro de automações', 'Administrador › Registro de automações: o que a planilha e o servidor fizeram sozinhos (PRÉ STACKING, DATA BAIXA, confirmações, avisos, status automático), com quem e quando.'],
      ['Servidor fora do ar', 'Quando o servidor não responde aparece uma faixa no topo (acordando ou fora do ar). Um monitor confere o servidor a cada 10 minutos, mantém acordado e abre um aviso no GitHub se cair.'],
      ['Custos de demurrage', 'Administrador › Custos de demurrage: diária por armador (20\' e 40\'). Os Indicadores do mês mostram o custo estimado das devoluções fora do prazo e o custo evitado.'],
    ] },
    { date: '06/11/2026', title: 'Validação do número do container', items: [
      ['Container', 'Nas colunas CONTAINER, 1 - CONTAINER e 2 - CONTAINER, o número é conferido pelo padrão internacional (4 letras, 6 números e o dígito verificador). Número errado ganha um sublinhado ondulado vermelho.'],
      ['Motivo', 'Passe o mouse no número sublinhado (no celular, toque na célula) para ver o motivo, por exemplo qual deveria ser o último dígito. Ao digitar ou colar um número errado, a planilha avisa na hora. Nada é bloqueado.'],
      ['Tema escuro', 'Corrigido: o texto de células com fundo claro próprio (como o cabeçalho cinza) voltou a aparecer no tema escuro.'],
    ] },
    { date: '06/11/2026', title: 'Notificações no celular, Painel do dia, tema escuro e Indicadores do mês', items: [
      ['Notificações', 'Ferramentas › Notificações no celular: avisa neste aparelho quando um container é marcado como crítico, quando pedem troca de veículo, quando chega mensagem no chat e (se quiser) quando um PRÉ STACKING é finalizado. No iPhone, funciona com o app da Tela de Início (iOS 16.4 ou mais novo).'],
      ['Painel do dia', 'Ver › Painel do dia (ou o calendário no cabeçalho): STATUS do MAPA IMPO e EXPO, PRÉ STACKING em aberto, agendamentos de hoje, atrasados no PRÉ STACKING e demurrage do vazio vencida ou vencendo em até 2 dias. Tocar num item leva até a linha.'],
      ['Tema escuro', 'Ver › Tema: Claro, Escuro ou Automático (segue o aparelho). As cores de STATUS e alertas continuam as mesmas.'],
      ['Indicadores do mês', 'Ver › Indicadores do mês: remoções, embarques, devoluções e retiradas por cliente, últimos 6 meses, vazio no prazo da demurrage e tempo do P.S. até o FINALIZADO. Exporta CSV.'],
    ] },
    { date: '06/11/2026', title: 'Celular e app no iPhone', items: [
      ['App no iPhone', 'No Safari, toque em Compartilhar › Adicionar à Tela de Início: a planilha abre como app, em tela cheia, com ícone próprio.'],
      ['Cabeçalho', 'No celular, o cabeçalho ocupa 2 linhas: título, ALERTA e botões em cima; os menus numa linha que rola de lado.'],
      ['Editar com toque', 'Um toque seleciona a célula; tocar de novo na mesma célula abre a edição com o teclado. O teclado não abre mais a cada toque.'],
      ['Menu com toque longo', 'Segurar o dedo numa célula abre o mesmo menu do botão direito.'],
      ['Zoom com pinça', 'Com dois dedos na grade, o zoom muda só a planilha (50% a 200%), sem ampliar os menus.'],
      ['Janelas e menus', 'Janelas, menus e painéis cabem na tela do celular, respeitam o entalhe e a barra de baixo do iPhone, e os campos não dão zoom ao tocar.'],
      ['Celular deitado', 'Com o celular deitado, os menus ficam na mesma linha do título para sobrar mais espaço para a planilha.'],
    ] },
    { date: '05/11/2026', title: 'Métricas: gráficos interativos e teste de pico de usuários', items: [
      ['Métricas', 'Administrador › "Métricas, gráficos e teste de pico" agora tem três abas: Agora (limite e quem está conectado), Gráficos e Teste de pico.'],
      ['Gráficos', 'Pessoas conectadas ao longo do dia, sessões de cada pessoa (entrada e saída), células editadas por hora e por dia e linhas com informação em cada página. Passe o mouse sobre os gráficos para ver os detalhes.'],
      ['Teste de pico', 'Simula até 60 pessoas editando ao mesmo tempo numa cópia temporária da planilha, só na memória do servidor: nada é gravado. Mostra ao vivo o tempo de resposta, as edições por segundo e o uso do servidor, e no fim diz se aguentou.'],
      ['Servidor', 'Na subida, o servidor tenta se conectar ao banco até 12 vezes (antes eram 6), porque o banco gratuito às vezes demora a responder.'],
    ] },
    { date: '05/11/2026', title: 'Métricas da planilha e limite de usuários', items: [
      ['Administrador', 'Novo item "Métricas da planilha e limite de usuários": quem está conectado agora (página, abas e desde quando), pico do dia, quem entrou, células editadas hoje e nos últimos 7 dias, tamanho da planilha e situação do servidor. A tela se atualiza sozinha a cada 15 segundos.'],
      ['Limite de usuários', 'O administrador escolhe quantas pessoas podem estar com a planilha aberta ao mesmo tempo (0 = sem limite). Administradores não ocupam vaga e sempre entram; a mesma pessoa em várias abas conta uma vez; baixar o limite não desconecta ninguém.'],
      ['Limite atingido', 'Quem chega com o limite cheio vê o aviso "Limite de pessoas atingido" com o botão Tentar de novo. As tentativas aparecem nas métricas em "Esperaram vaga".'],
    ] },
    { date: '05/11/2026', title: 'MAPA ↔ PRÉ STACKING com confirmação, DATA BAIXA em todas as linhas, linhas de grade e crítico', items: [
      ['MAPA ↔ PRÉ STACKING', 'Com a unidade já no PRÉ STACKING, mudar um campo no MAPA (ex.: TERMINAL VAZIO / depot) ou no PRÉ STACKING pergunta "Unidade em Pré-Stacking deseja atualizar informação?"; com Sim, o outro lado é atualizado.'],
      ['DATA BAIXA', 'Sempre que um container entra no PRÉ STACKING VAZIO (pelo P.S. VZ, digitado ou colado), todas as DATA BAIXA vazias da aba são buscadas na API de uma vez. Trocar o container busca a data de novo.'],
      ['Motoristas do DSS', 'A lista de motoristas é buscada no DSS uma vez por dia e guardada no banco; o servidor usa a do banco ao reiniciar.'],
      ['Linhas de grade', 'Linhas de grade e bordas ficam com a mesma espessura em todas as células, também com zoom ou escala do Windows (125%, 150%).'],
      ['Crítico', 'Célula vazia não pisca mais o alerta de crítico.'],
    ] },
    { date: '05/11/2026', title: 'Containers da Carga OF (API carga_of_container)', items: [
      ['Administrador', 'Novo item "Containers da Carga OF (DATA BAIXA)", no mesmo jeito dos Motoristas do DSS: escolha a coluna do CONTAINER e a da data. Ao digitar ou colar um container nessa coluna, a data de entrada vem da API em dd/mm/aaaa.'],
      ['Consulta', 'Na mesma tela: se a API está respondendo, consulta de um container (com ou sem espaço, ponto e traço), últimas entradas e "Preencher vazios" para buscar de uma vez os containers sem data.'],
      ['Conexão', 'Quando a API falha por instantes, a planilha tenta de novo; o erro mostra o motivo (certificado HTTPS, conexão recusada, tempo esgotado).'],
    ] },
    { date: '05/11/2026', title: 'PRÉ STACKING automático (P.S. CH / P.S. VZ), marcas SC / SPOT e anexos até 17 MB', items: [
      ['P.S. CH', 'Marcar a caixa P.S. CH no MAPA IMPO muda o STATUS para AG. REMOÇÃO (no MAPA EXPO, AG. EMBARQUE) e cria a linha no PRÉ STACKING CHEIO, 2 linhas depois da última informação, com CLIENTE, RESERVA / DI, NAVIO, VIAGEM, OPERAÇÃO, CONTAINER, TIPO, PESO, TERMINAL, AGENDAMENTO e VISIT CODE.'],
      ['P.S. VZ', 'Marcar P.S. VZ no MAPA IMPO muda o STATUS para AG. DEVOLUÇÃO (no MAPA EXPO, AG. RETIRADA) e cria a linha no PRÉ STACKING VAZIO com CLIENTE, ARMADOR, DEMMURAGE, RESERVA / DI, OPERAÇÃO, CONTAINER, TIPO, TERMINAL e AGENDAMENTO.'],
      ['Clientes da regra', 'Administrador › "PRÉ STACKING VAZIO: clientes com 1 - / 2 - CONTAINER": para esses clientes, container, armador e tipo vêm das colunas 1 - e 2 -; com 2 - preenchido, são criadas 2 linhas.'],
      ['Volta para o MAPA', 'O que for mudado no PRÉ STACKING (nas colunas que vieram do MAPA) é atualizado na linha do MAPA. A DATA do PRÉ STACKING VAZIO preenche a DATA ENTREGA VAZIO do MAPA IMPO.'],
      ['DATA BAIXA', 'Ao criar a linha no PRÉ STACKING VAZIO (ou trocar o CONTAINER), a planilha procura o container na API carga_of_container (sem espaço, ponto e traço) e preenche a DATA BAIXA em dd/mm/aaaa.'],
      ['Finalizado', 'STATUS FINALIZADO no PRÉ STACKING CHEIO muda o MAPA para EM ABERTO (IMPO) ou PROC. - FINALIZADO (EXPO). No PRÉ STACKING VAZIO, para AG. INTERCÂMBIO (IMPO) ou EM ABERTO (EXPO); com 2 linhas, quando as duas estiverem finalizadas.'],
      ['Sem duplicar', 'Desmarcar e marcar de novo não cria outra linha; um Desfazer volta tudo (caixa, STATUS e linhas do PRÉ STACKING).'],
      ['MODALIDADE', 'As marcas SC e SPOT ficam no canto superior direito, antes da seta, uma embaixo da outra, com o fundo mais transparente.'],
      ['Enviar por e-mail', 'O limite dos anexos continua 15 MB, mas passando um pouco (até 17 MB) o envio ainda é aceito.'],
    ] },
    { date: '05/11/2026', title: 'E-mail com assinatura, busca livre do assunto e marcas SC / SPOT', items: [
      ['Enviar por e-mail', 'Campo para procurar a conversa pela REFERENCIA ou por qualquer texto do assunto (botão para voltar à referência).'],
      ['Assinatura', 'A assinatura em imagem configurada no webmail vai em todo envio, logo abaixo da tabela. As assinaturas das mensagens anteriores continuam no histórico citado.'],
      ['Tela de envio', 'Situação da busca ao lado do título, "Última mensagem da conversa" mostrada como no e-mail, mensagem antes da tabela maior, anexos com arrastar e soltar e limite de 15 MB somados.'],
      ['Remetente', 'O nome que aparece para quem recebe passa a ser "Follow-up | Costalog".'],
      ['Validação de dados', 'A lista com todas as regras fica em ordem de coluna (C, depois D, depois F…) e mostra o nome da coluna.'],
      ['MODALIDADE', 'Botão direito na coluna MODALIDADE: "Operação sem custos (SC)" e "Operação FRETE SPOT". A marca aparece pequena, em vermelho, no canto esquerdo da célula.'],
    ] },
    { date: '05/11/2026', title: 'Rodotrem, letreiro de alertas, impressão de documentos e sessões', items: [
      ['Rodotrem', 'Confirmar escala (também na escala manual) reconhece o rodotrem e confirma as duas linhas com a mesma placa, mesmo selecionando só uma. Ao escalar um rodotrem, as 2 linhas ficam marcadas como par.'],
      ['Pedido de troca', 'Ao pedir a troca, CAVALO, CARRETA, MOTORISTA, CPF e CONTATO piscam em azul (antes só as 3 primeiras).'],
      ['ALERTA', 'Rodotrem conta como 1 alerta só (aparece "Linhas 5 e 6 · rodotrem"). Ao lado do botão ALERTA, um letreiro passa os alertas do momento; clique num deles para ir à linha, e pare o mouse em cima para ler.'],
      ['Imprimir', 'Botão direito na linha › Imprimir: Minuta de devolução, Minuta de devolução (Glovis), Ordem de coleta, Liberação de vazio e Ficha completa da linha. Uma página por linha selecionada, com opção de salvar em PDF.'],
      ['Administrador', 'Administrador › "Sessões: deslogar usuários": encerra o login de todos ou só das pessoas escolhidas; quem estiver na planilha sai na hora.'],
      ['Chat', 'Emojis e figurinhas reorganizados: abas com ícones (sem barra de rolagem), figurinhas inteiras em blocos menores e figurinha enviada com visual de cartão.'],
      ['Pessoas na planilha', 'As bolinhas do topo não repetem mais a mesma pessoa (várias abas contam uma vez) e o "+N" abre a lista com todos, com "Ir até" e mensagem.'],
      ['Enviar status', 'A coluna STATUS da tabela foi trocada pela OBSERVAÇÃO.'],
      ['Enviar por e-mail', 'A resposta continua a conversa: responde à última mensagem do assunto (inclusive uma resposta nossa nos Enviados) e leva embaixo o histórico citado ("De / Enviada em / Para / Assunto"), como o Outlook.'],
    ] },
    { date: '04/11/2026', title: 'Envio de e-mail por HTTPS (a hospedagem bloqueia SMTP)', items: [
      ['Enviar por e-mail', 'O servidor onde a planilha roda (Render) bloqueia as portas de SMTP, então o envio passa a sair por HTTPS, pelo serviço de envio configurado. A busca da conversa continua por IMAP, que funciona normalmente.'],
      ['Enviar por e-mail', 'A resposta continua caindo dentro da mesma conversa do cliente (mantém In-Reply-To e References), com a tabela, os anexos e o remetente de sempre.'],
      ['Enviados', 'Uma cópia da mensagem enviada é guardada na pasta Enviados do webmail, para o histórico ficar completo para quem olha pelo Supramail.'],
    ] },
    { date: '04/11/2026', title: 'Enviar status por e-mail, direto da planilha', items: [
      ['Enviar status', 'Botão "✉ Enviar por e-mail" em cada referência. A planilha procura no e-mail a conversa com aquela REFERENCIA no assunto, monta o responder a todos com a tabela no corpo e envia.'],
      ['Enviar status', 'Antes de enviar aparece uma tela com a conversa encontrada, o assunto, o Para e a Cópia (todos editáveis), a mensagem de abertura e a prévia da tabela. Nada sai sem você confirmar.'],
      ['Anexos', 'Dá para anexar arquivos do seu computador na mesma tela, até 18 MB por arquivo.'],
      ['Sem conversa', 'Se nenhuma mensagem tiver aquela referência no assunto, dá para enviar como e-mail novo, com o assunto STATUS - REFERENCIA: ...'],
      ['Administrador', 'Administrador › "Enviar status por e-mail: quem pode" escolhe os setores e pessoas liberados.'],
    ] },
    { date: '04/11/2026', title: 'Enviar status: colunas com complemento no nome', items: [
      ['Enviar status', 'Colunas como "CHEGADA NO TERMINAL / EADI" e "SAÍDA DO TERMINAL / EADI" passam a entrar na tabela — antes ficavam de fora porque o nome não batia exatamente. No e-mail elas aparecem com o nome curto (CHEGADA NO TERMINAL).'],
    ] },
    { date: '04/11/2026', title: 'Enviar status agrupado por REFERENCIA', items: [
      ['Enviar status', 'As linhas selecionadas são agrupadas pela coluna REFERENCIA: cada referência vira um bloco, e o valor da referência é o assunto que você procura no e-mail.'],
      ['Enviar status', 'A tabela de cada bloco traz TODAS as linhas daquela referência, mesmo as que você não selecionou — é o status completo do processo. Dá para voltar ao comportamento antigo com "Só as linhas que eu selecionei".'],
      ['Enviar status', 'Botão "Copiar assunto" (a referência) e "Copiar tabela" em cada bloco. Com uma referência só, a tabela continua sendo copiada sozinha ao abrir.'],
    ] },
    { date: '04/11/2026', title: 'ALERTA, visualizações salvas, emojis no chat e IP no histórico', items: [
      ['ALERTA', 'Botão ALERTA no centro do cabeçalho: mostra tudo o que precisa de atenção, de acordo com as regras do administrador (Administrador › Regras de alerta). Cada regra pode valer para todos ou só para alguns setores/pessoas.'],
      ['Regras de alerta', 'Regras prontas (container crítico, ARM/DEM vencendo, escala aguardando confirmação, pedido de troca, PROG. duplicado, FRETE de terceiro, veículo incompleto) ou condições nas colunas (vazia, igual, contém, data de hoje, vence em N dias, repetida…).'],
      ['Visualizações', 'Salvar a visualização com filtro com um nome, só para você ou para todos da planilha; qualquer pessoa abre as compartilhadas em Visualizações salvas.'],
      ['Chat', 'Emojis e figurinhas (Ok!, A caminho, Urgente, Feito…) no botão 😊 da conversa.'],
      ['Histórico da célula', 'Mostra o IP de onde a pessoa editou (para administradores) e tem "Ver todas as edições" numa tela só, com busca.'],
      ['Veículo', 'Apagar a placa (CAVALO) ou o MOTORISTA apaga junto CARRETA, CPF e CONTATO. Com CAVALO preenchido, os outros campos ficam em laranja até serem preenchidos, e a escala só é confirmada com tudo preenchido.'],
      ['Avisos', 'A dica de PROG. duplicado (e as demais dicas) fica na tela enquanto o mouse estiver sobre a célula.'],
      ['Histórico de versões', '"Só linhas alteradas" mostra apenas o que mudou.'],
    ] },
    { date: '04/11/2026', title: 'Permissões num lugar só, histórico de versões com prévia e correções', items: [
      ['Menus', 'Os itens dentro dos submenus (ex.: Formatar › Alinhamento › Centro) voltaram a funcionar ao clicar; Recortar e Copiar pelo menu Editar também.'],
      ['Administrador', 'Novo menu Administrador e o painel "Controle do administrador": todas as opções de quem pode ver, editar ou usar cada função ficam ali, e não mais no botão direito.'],
      ['Permissões', 'Além de setores, agora dá para escolher pessoas específicas em: escala de veículos, container crítico e intervalos protegidos.'],
      ['Histórico de versões', 'Prévia de cada versão com as mudanças daquele backup em destaque (verde = alterado, vermelho = apagado; passe o mouse para ver o valor anterior). Dá para restaurar ou criar uma cópia. Na nuvem, uma versão é guardada a cada 3 horas, só quando houve alteração.'],
      ['Enviar status', 'Funciona com várias linhas selecionadas (arrastando ou com Ctrl) e também pelo menu Inserir.'],
      ['Pedido de troca', 'Depois de destravar, a mensagem do pedido mostra "Troca liberada" para todos do setor e para quem pediu; o botão não destrava de novo.'],
      ['Menu suspenso', 'As opções mostram as cores da formatação condicional (ex.: cada STATUS com a sua cor).'],
      ['PROG.', 'Número de programação repetido fica roxo e avisa em quais linhas está, para corrigir.'],
      ['Alinhamento', 'Padrão das células: centralizado na horizontal e no meio na vertical.'],
      ['Escala', 'Apagar o motorista não deixa mais células vazias em vermelho; apagar o veículo inteiro tira a linha da escala.'],
      ['Cabeçalho', 'O nome da planilha ganhou mais espaço e não corta mais.'],
      ['Funções', 'Novas funções de fórmula (veja Ajuda › Lista de funções).'],
    ] },
    { date: '04/11/2026', title: 'Incluir processo com BASE GERAL, Informar críticos e Enviar status', items: [
      ['Incluir processo', 'CLIENTE mostra sugestões com cidade e endereço e já preenche ENTREGA e ENDEREÇO; os terminais mostram a cidade. Saiu o campo CIDADE DEPOT.'],
      ['Menus suspensos', 'Abrem só ao clicar na seta; caixas de seleção só mudam ao clicar na caixa.'],
      ['Crítico e IMO', 'Param de piscar quando a CHEGADA NO CLIENTE é preenchida.'],
      ['ARM e DEM', 'Datas (dd/mm) piscam em vermelho no dia do vencimento e no dia anterior.'],
      ['Informar críticos', 'Inserir › Informar críticos: cole os containers, veja as linhas e clientes e marque todos de uma vez.'],
      ['Enviar status', 'Botão direito nas linhas › Enviar status: monta a tabela no padrão do e-mail (cabeçalho vermelho) e já copia.'],
      ['Escala', 'Veículo colado ou digitado fora do Escalar veículo fica vermelho até alguém usar Confirmar escala.'],
    ] },
    { date: '03/11/2026', title: 'Escala de veículos, BASE GERAL e muitas melhorias', items: [
      ['Container crítico', 'O administrador escolhe quem pode marcar container crítico.'],
      ['Colunas', 'O administrador muda colunas de lugar na planilha (vale para todos); as visualizações com filtro voltaram a ser pessoais.'],
      ['BASE GERAL', 'Quem não vê a aba BASE GERAL continua com menus, validações e avisos funcionando. A linha 1 vale como dado quando as colunas têm nome.'],
      ['BASE GERAL', 'Clientes (com cidade e endereço) e terminais (com a cidade) aparecem nos menus; ao escolher o cliente, ENTREGA e ENDEREÇO são preenchidos.'],
      ['Data com horário', 'Novo tipo de validação com calendário e horário inicial e final (ex.: 03/11/2026 15:00 ÁS 16:00).'],
      ['Escala de veículos', 'Escalar veículo pela ESCALA DE FROTA, rodotrem como um veículo só (2 linhas), confirmação da escala (vermelho até confirmar), bloqueio para troca com animação de cadeado e pedido de troca pelo chat (pisca em azul).'],
      ['Escala de veículos', 'Ao clicar no CAVALO aparecem MARCA, TIPO e CATEGORIA da BASE GERAL; placa fora da BASE GERAL é Terceiro e o FRETE pisca até ser preenchido. A 2ª viagem do mesmo motorista vai para a aba JORNADA.'],
      ['Perfil', 'Foto no perfil; cor única para cada pessoa.'],
      ['Incluir processo', 'Inserir › Incluir processo: abre o processo com vários carregamentos de uma vez, a partir de 2 linhas depois da última informação, com status NOVO.'],
      ['Abas', 'Cor de aba personalizada e aba inteira colorida.'],
      ['Seleção', 'Ctrl + clique para selecionar várias partes da planilha ao mesmo tempo.'],
      ['Formatação condicional', 'Salva na hora e aparece para todos, pode ser duplicada e reordenada, e pode valer até a última linha.'],
      ['Mensagens', 'Mensagens diretas para uma pessoa, com a célula junto; o rascunho não fica preso depois de enviar.'],
      ['Servidor', 'Planilha guardada compactada e gravada a cada ~10 s: servidor bem mais estável.'],
      ['DSS', 'Apagar o motorista apaga o CPF; apagar o CPF com motorista preenchido faz o CPF voltar sozinho (só números).'],
    ] },
    { date: '30/10/2026', title: 'Tempo real, setores e permissões', items: [
      ['Tempo real', 'Várias pessoas editando juntas, com login e presença (quem está onde).'],
      ['Permissões', 'Por setor e por pessoa: quais páginas e quais colunas cada um vê ou edita. Os setores preenchem valores; a estrutura é dos administradores.'],
      ['Histórico por célula', 'Botão direito › Mostrar histórico de edições: quem mudou, quando e o valor anterior.'],
      ['Visualizações de filtro', 'Filtros e agrupamentos pessoais, que não mudam a tela dos outros (com grupos com + e últimos N dias).'],
      ['DSS', 'Lista de motoristas do DSS na coluna do motorista, completando o CPF/CNPJ.'],
      ['Container crítico', 'Marcar container como crítico faz a célula piscar como alerta.'],
    ] },
    { date: '29/10/2026', title: 'Primeira versão', items: [
      ['Planilha', 'Editor de planilhas no estilo do Google Planilhas: fórmulas, formatação, gráficos, filtros, validação, formatação condicional, minigráficos e imagens.'],
      ['Publicação', 'Site publicado automaticamente.'],
    ] },
  ];
  App.UPDATES = UPDATES;

  function show() {
    const m = App.ui.modal({
      title: 'Últimas atualizações', width: '720px', cls: 'upd-modal', enterSubmits: false,
      body: `<input class="input upd-search" id="upd-q" placeholder="Pesquisar nas atualizações (ex.: escala, crítico, filtro)" autocomplete="off"><div class="upd-list" id="upd-list"></div>`,
      buttons: [{ label: 'Fechar', primary: true }],
    });
    const list = m.el.querySelector('#upd-list'), q = m.el.querySelector('#upd-q');
    const fold = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const draw = () => {
      const k = fold(q.value.trim());
      const html = UPDATES.map((u) => {
        const items = u.items.filter(([a, t]) => !k || fold(a + ' ' + t + ' ' + u.title).includes(k));
        if (!items.length) return '';
        return `<section class="upd-day"><div class="upd-head"><span class="upd-date">${esc(u.date)}</span><b>${esc(u.title)}</b></div>
          <ul>${items.map(([a, t]) => `<li><span class="upd-tag">${esc(a)}</span>${esc(t)}</li>`).join('')}</ul></section>`;
      }).join('');
      list.innerHTML = html || '<p class="sp-hint">Nada encontrado.</p>';
    };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', (e) => e.stopPropagation());
    draw();
  }
  App.commands.def('updates', 'Últimas atualizações', show);
})(window.App);
