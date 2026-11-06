// Registro de automações, alertas para o celular e aviso de servidor fora do ar.
// - App.logAuto(tipo, desc, aba): guarda no servidor o que a planilha fez sozinha (PRÉ STACKING, DATA BAIXA,
//   confirmações…), com quem estava usando. Administrador › Registro de automações mostra tudo.
// - App.reportaAlertas(lista): o ALERTA calcula as regras nesta tela; os alertas novos vão para o servidor, que avisa
//   no celular de quem ligou as notificações (uma vez só, mesmo com várias pessoas abertas).
// - Faixa no topo quando o servidor não responde (o Render gratuito "dorme" e leva até 1 min para acordar).
(function (App) {
  'use strict';
  const esc = App.esc, $ = (id) => document.getElementById(id);
  const docId = () => (App.cloudMode && App.cloud && App.cloud.id) || null;
  const api = (...a) => App.collab.api(...a);

  // ---------- registro ----------
  let fila = [], tAuto = null;
  App.logAuto = (tipo, desc, aba) => {
    if (!docId()) return;
    fila.push({ tipo, desc: String(desc || '').slice(0, 400), aba: aba || '' });
    clearTimeout(tAuto);
    tAuto = setTimeout(() => { const id = docId(), itens = fila.splice(0, 50); if (id && itens.length) api('POST', `/api/docs/${id}/automacoes`, { itens }).catch(() => {}); }, 1500);
  };
  App.commands.def('automacoes', 'Registro de automações', async () => {
    if (!docId()) return App.emit('notify', 'O registro de automações fica no servidor: abra a planilha na nuvem.');
    let lista;
    try { lista = await api('GET', `/api/docs/${docId()}/automacoes`); } catch (e) { return App.emit('notify', e.message); }
    const tipos = [...new Set(lista.map((x) => x.tipo))].sort();
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="au-bar"><select class="input" id="au-t"><option value="">Todos os tipos</option>${tipos.map((t) => `<option>${esc(t)}</option>`).join('')}</select><input class="input" id="au-q" placeholder="Procurar (container, pessoa…)"></div><div class="ind-tbl au-tbl"><table><thead><tr><th>Quando</th><th>Tipo</th><th>O que aconteceu</th><th>Quem</th></tr></thead><tbody></tbody></table></div><p class="sp-hint" id="au-n"></p>`;
    const draw = () => {
      const t = wrap.querySelector('#au-t').value, q = wrap.querySelector('#au-q').value.trim().toLowerCase();
      const f = lista.filter((x) => (!t || x.tipo === t) && (!q || (x.desc + ' ' + x.por + ' ' + x.aba).toLowerCase().includes(q)));
      wrap.querySelector('tbody').innerHTML = f.slice(0, 500).map((x) => `<tr><td>${esc(new Date(x.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</td><td>${esc(x.tipo)}</td><td>${esc(x.desc)}${x.aba ? ` <small>(${esc(x.aba)})</small>` : ''}</td><td>${esc(x.origem === 'servidor' ? 'Servidor (automático)' : x.por)}</td></tr>`).join('') || '<tr><td colspan="4" class="sp-hint">Nada registrado.</td></tr>';
      wrap.querySelector('#au-n').textContent = `${f.length} ${f.length === 1 ? 'registro' : 'registros'}${f.length > 500 ? ' (mostrando os 500 mais recentes)' : ''}.`;
    };
    wrap.querySelector('#au-t').onchange = draw; wrap.querySelector('#au-q').oninput = draw;
    draw();
    App.ui.modal({ title: 'Registro de automações', width: '900px', cls: 'modal-tall', body: wrap, buttons: [{ label: 'Fechar', primary: true }] });
  });

  // ---------- alertas novos → celular ----------
  const enviados = new Set();
  let tAl = null, ultimo = null;
  App.reportaAlertas = (list) => {
    if (!docId()) return;
    ultimo = list;
    clearTimeout(tAl);
    tAl = setTimeout(() => {
      const id = docId();
      if (!id || !ultimo) return;
      const itens = [];
      for (const g of ultimo) for (const x of g.rows) {
        const chave = x.cols.map((y) => y.t).join('|') || 'linha' + x.r;
        const k = `${g.sh.id}|${g.rule.id || g.rule.name}|${chave}`;
        if (enviados.has(k)) continue;
        itens.push({ k, sheetId: g.sh.id, regra: g.rule.id, title: g.rule.name, body: `${g.sh.name}: ${x.cols.map((y) => y.t).join(' · ') || 'linha ' + x.r}` });
      }
      if (!itens.length) return;
      api('POST', `/api/docs/${id}/alertas/novos`, { itens: itens.slice(0, 200) }).then(() => itens.forEach((x) => enviados.add(x.k))).catch(() => {});
    }, 3000);
  };

  // ---------- servidor fora do ar ----------
  let desde = null, timer = null;
  function faixa() {
    let el = $('srv-faixa');
    const st = $('save-status'), off = !!(App.cloudMode && st && st.classList.contains('offline'));
    if (!off) {
      if (desde && el) { el.className = 'srv-faixa ok'; el.textContent = 'Conexão com o servidor restabelecida.'; setTimeout(() => { if (!desde && el) el.remove(); }, 3000); }
      desde = null; clearInterval(timer); timer = null;
      return;
    }
    if (!desde) { desde = Date.now(); timer = setInterval(faixa, 2000); }
    const s = Math.round((Date.now() - desde) / 1000);
    if (s < 6) return;
    if (!el) { el = document.createElement('div'); el.id = 'srv-faixa'; document.body.appendChild(el); }
    el.className = 'srv-faixa ' + (s > 120 ? 'bad' : 'warn');
    el.textContent = s > 120
      ? `Servidor fora do ar há ${Math.round(s / 60)} min. As alterações ficam guardadas aqui e são enviadas quando ele voltar. Se continuar, avise o administrador.`
      : 'Servidor sem resposta (pode estar acordando, leva até 1 minuto). Tentando reconectar…';
  }
  function init() {
    // confere o estado da conexão a cada 3 s (o indicador "Salvo na nuvem" pode ser criado depois)
    setInterval(() => { if (!timer) faixa(); }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.App);
