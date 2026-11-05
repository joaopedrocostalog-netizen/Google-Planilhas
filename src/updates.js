// Ajuda › Últimas atualizações: tudo o que mudou na planilha, por data, explicado de um jeito simples.
(function (App) {
  'use strict';
  const esc = App.esc;
  // a mais nova primeiro; cada item: [área, o que mudou]
  const UPDATES = [
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
      ['Histórico de versões', 'Prévia de cada versão com as mudanças daquele backup em destaque (verde = alterado, vermelho = apagado; passe o mouse para ver o valor anterior). Dá para restaurar ou criar uma cópia. Na nuvem, uma versão é guardada a cada 30 minutos de edição.'],
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
