(function () {
  "use strict";

  const root = document.getElementById("app");
  const toastRegion = document.getElementById("toast-region");
  const cfg = window.APP_CONFIG || {};
  const initialHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const initialSearchParams = new URLSearchParams(window.location.search);
  const recoveryAccessToken = initialHashParams.get("access_token");
  const recoveryRefreshToken = initialHashParams.get("refresh_token");
  const recoveryCode = initialSearchParams.get("code");
  const recoveryLinkRequested =
    initialHashParams.get("type") === "recovery" ||
    initialSearchParams.get("type") === "recovery" ||
    Boolean(recoveryCode);
  const configured =
    /^https:\/\/.+\.supabase\.co$/.test(cfg.SUPABASE_URL || "") &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_ANON_KEY.includes("COLE_AQUI");

  let sb = null;
  let installPrompt = null;
  const state = {
    session: null,
    profile: null,
    route: "inicio",
    activities: [],
    profiles: [],
    reportRows: [],
    batchResults: [],
    busy: false
  };

  const activityTypes = [
    "Corrida", "Caminhada", "Musculação", "Treinamento funcional",
    "Alongamento", "Bicicleta", "Futebol", "Outra"
  ];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toast(message, type) {
    const item = document.createElement("div");
    item.className = "toast " + (type || "");
    item.textContent = message;
    toastRegion.appendChild(item);
    setTimeout(function () { item.remove(); }, 4200);
  }

  function errorMessage(error) {
    const raw = error && error.message ? error.message : String(error || "Erro inesperado");
    const known = {
      "Invalid login credentials": "RE/e-mail ou senha incorretos.",
      "Email not confirmed": "O acesso ainda não foi confirmado.",
      "Failed to fetch": "Não foi possível conectar. Verifique a internet."
    };
    return known[raw] || raw;
  }

  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll("button[type='submit']").forEach(function (button) {
      button.disabled = value;
    });
  }

  function dateBR(value) {
    if (!value) return "—";
    const parts = String(value).slice(0, 10).split("-");
    return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : value;
  }

  function dateTimeBR(value) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short", timeStyle: "short"
    }).format(new Date(value));
  }

  function minutesLabel(value) {
    const minutes = Number(value || 0);
    if (minutes < 60) return minutes + " min";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h + "h" + (m ? " " + m + "min" : "");
  }

  function normalizeLogin(value) {
    const login = String(value || "").trim().toLowerCase();
    if (login.includes("@")) return login;
    const re = login.replace(/[^a-z0-9]/g, "");
    return "re." + re + "@controle-interno.local";
  }

  function todayISO() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function firstDayOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }

  function isCommander() {
    return state.profile && state.profile.role === "comandante";
  }

  function administrativeLabel(profile) {
    if (!profile || profile.role !== "comandante") return "Policial";
    return /^Cap\b/i.test(String(profile.graduacao || "").trim()) ? "Comandante" : "Administrador";
  }

  function statusBadge(status) {
    const signed = status === "ASSINADO";
    return "<span class='status " + (signed ? "status-signed" : "status-pending") + "'>" +
      esc(status || "PENDENTE") + "</span>";
  }

  function routeButton(route, icon, label) {
    return "<button class='nav-button " + (state.route === route ? "active" : "") +
      "' data-route='" + route + "'><span class='nav-icon'>" + icon +
      "</span><span>" + label + "</span></button>";
  }

  function renderSetup() {
    root.innerHTML =
      "<main class='config-screen'>" +
        "<section class='panel'>" +
          "<div class='panel-header'><h2>Conectar o banco de dados</h2></div>" +
          "<div class='panel-body stack'>" +
            "<div class='notice notice-warning'>O aplicativo está pronto, mas ainda precisa das duas chaves públicas do seu projeto Supabase.</div>" +
            "<p>Abra o arquivo <span class='code'>dist/config.js</span> e preencha <span class='code'>SUPABASE_URL</span> e <span class='code'>SUPABASE_ANON_KEY</span>. A chave anon é pública por definição; a proteção dos dados é feita pelas políticas RLS incluídas no projeto.</p>" +
            "<p class='help'>A chave service_role nunca deve ser colocada neste arquivo.</p>" +
          "</div>" +
        "</section>" +
      "</main>";
  }

  function renderLogin() {
    root.innerHTML =
      "<main class='login-shell'>" +
        "<section class='login-card'>" +
          "<div class='login-brand'>" +
            "<div class='brand-mark'>AF</div>" +
            "<div><h1>Controle de Atividade Física do Efetivo</h1><p>Acesso restrito</p></div>" +
          "</div>" +
          "<form id='login-form' class='stack'>" +
            "<div class='field'><label for='login'>RE ou e-mail</label><input id='login' name='login' autocomplete='username' required placeholder='Digite seu RE' /></div>" +
            "<div class='field'><label for='password'>Senha</label><input id='password' name='password' type='password' autocomplete='current-password' required minlength='6' placeholder='Digite sua senha' /></div>" +
            "<button class='btn btn-primary' type='submit'>ENTRAR</button>" +
            "<button class='btn btn-secondary' type='button' data-action='forgot-password'>ESQUECI MINHA SENHA</button>" +
          "</form>" +
          "<div class='privacy-note'>Ferramenta privada de controle administrativo. Não é um aplicativo oficial da Polícia Militar.</div>" +
        "</section>" +
      "</main>";
  }

  function renderRecoveryRequest() {
    root.innerHTML =
      "<main class='login-shell'>" +
        "<section class='login-card'>" +
          "<div class='login-brand'>" +
            "<div class='brand-mark'>AF</div>" +
            "<div><h1>Recuperar senha</h1><p>Receba um link seguro por e-mail</p></div>" +
          "</div>" +
          "<form id='recovery-request-form' class='stack'>" +
            "<div class='field'><label for='recovery-email'>E-mail cadastrado</label><input id='recovery-email' name='email' type='email' autocomplete='email' required placeholder='Digite seu e-mail' /></div>" +
            "<button class='btn btn-primary' type='submit'>ENVIAR LINK</button>" +
            "<button class='btn btn-secondary' type='button' data-action='back-login'>VOLTAR</button>" +
          "</form>" +
          "<div class='privacy-note'>Se o e-mail estiver cadastrado, você receberá as instruções para escolher uma nova senha.</div>" +
        "</section>" +
      "</main>";
  }

  function renderResetPassword() {
    root.innerHTML =
      "<main class='login-shell'>" +
        "<section class='login-card'>" +
          "<div class='login-brand'>" +
            "<div class='brand-mark'>AF</div>" +
            "<div><h1>Criar nova senha</h1><p>Escolha uma senha com pelo menos 8 caracteres</p></div>" +
          "</div>" +
          "<form id='reset-password-form' class='stack'>" +
            "<div class='field'><label for='new-password'>Nova senha</label><input id='new-password' name='password' type='password' autocomplete='new-password' required minlength='8' placeholder='Digite a nova senha' /></div>" +
            "<div class='field'><label for='confirm-password'>Confirmar nova senha</label><input id='confirm-password' name='confirmation' type='password' autocomplete='new-password' required minlength='8' placeholder='Digite novamente' /></div>" +
            "<button class='btn btn-primary' type='submit'>SALVAR NOVA SENHA</button>" +
          "</form>" +
        "</section>" +
      "</main>";
  }

  function renderShell(content) {
    const policeNav =
      routeButton("inicio", "⌂", "Início") +
      routeButton("registrar", "＋", "Registrar") +
      routeButton("minhas-atividades", "◷", "Atividades") +
      routeButton("assinatura", "✎", "Assinatura");
    const adminNav =
      routeButton("painel", "▦", "Painel") +
      routeButton("inicio", "⌂", "Minha área") +
      routeButton("registrar", "＋", "Registrar atividade") +
      routeButton("minhas-atividades", "◷", "Minhas atividades") +
      routeButton("assinatura", "✎", "Minha assinatura") +
      routeButton("registros", "≡", "Registros") +
      routeButton("efetivo", "♙", "Efetivo") +
      routeButton("relatorios", "▤", "Relatórios");
    root.innerHTML =
      "<div class='app-shell'>" +
        "<header class='topbar'>" +
          "<div class='topbar-brand'><div class='brand-mark'>AF</div><div><div class='topbar-title'>Controle de Atividade Física</div><div class='topbar-user'>" + esc(state.profile.nome) + " · RE " + esc(state.profile.re) + "</div></div></div>" +
          "<div class='topbar-actions'><span class='role-chip'>" + (isCommander() ? administrativeLabel(state.profile).toUpperCase() : "EFETIVO") + "</span><button class='btn btn-secondary btn-small icon-button' data-action='logout' aria-label='Sair' title='Sair'>↪</button></div>" +
        "</header>" +
        "<div class='layout'><aside class='sidebar'><nav class='nav-list' aria-label='Navegação principal'>" +
          (isCommander() ? adminNav : policeNav) +
        "</nav></aside><main class='main'>" + content + "</main></div>" +
      "</div>";
  }

  function pageHeading(kicker, title, subtitle, actions) {
    return "<div class='page-heading'><div><p class='eyebrow'>" + esc(kicker) + "</p><h1>" +
      esc(title) + "</h1>" + (subtitle ? "<p>" + esc(subtitle) + "</p>" : "") +
      "</div>" + (actions || "") + "</div>";
  }

  function renderHome() {
    const hasSignature = !!state.profile.assinatura_path;
    const html =
      "<section class='page'>" +
        pageHeading("ÁREA DO POLICIAL", "Olá, " + state.profile.nome.split(" ")[0],
          hasSignature ? "Registre a atividade realizada durante o serviço." : "Cadastre sua assinatura antes do primeiro registro.") +
        (!hasSignature ? "<div class='notice notice-warning'>Sua assinatura ainda não foi cadastrada. Esse cadastro é necessário para assinar uma atividade.</div>" : "") +
        "<div class='grid-actions'>" +
          "<button class='action-card' data-route='registrar'><span class='action-icon'>＋</span><strong>REGISTRAR ATIVIDADE</strong><span>Informe horário, tipo e local</span></button>" +
          "<button class='action-card' data-route='minhas-atividades'><span class='action-icon'>◷</span><strong>MINHAS ATIVIDADES</strong><span>Consulte seu histórico</span></button>" +
          "<button class='action-card' data-route='assinatura'><span class='action-icon'>✎</span><strong>MINHA ASSINATURA</strong><span>" + (hasSignature ? "Visualizar ou alterar" : "Cadastrar agora") + "</span></button>" +
        "</div>" +
        "<section class='panel'><div class='panel-header'><h2>Orientação</h2></div><div class='panel-body'><p style='margin:0'>Cada registro recebe uma cópia da assinatura existente no momento da confirmação. Depois de assinado, o registro não poderá ser editado ou excluído por você.</p></div></section>" +
      "</section>";
    renderShell(html);
  }

  function renderActivityForm() {
    if (!state.profile.assinatura_path) {
      state.route = "assinatura";
      renderSignature();
      toast("Cadastre sua assinatura antes de registrar a atividade.", "error");
      return;
    }
    const options = activityTypes.map(function (item) {
      return "<option value='" + esc(item) + "'>" + esc(item) + "</option>";
    }).join("");
    const now = new Date();
    const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(11, 16);
    const html =
      "<section class='page'>" +
        pageHeading("NOVO REGISTRO", "Registrar atividade", "Confira os dados antes de assinar.") +
        "<form id='activity-form' class='panel'>" +
          "<div class='panel-body stack'><div class='form-grid'>" +
            "<div class='field'><label for='data'>Data</label><input id='data' name='data' type='date' required max='" + todayISO() + "' value='" + todayISO() + "' /></div>" +
            "<div class='field'><label>Duração calculada</label><div class='duration-box' id='duration-display'>0 min</div></div>" +
            "<div class='field'><label for='hora_inicio'>Hora de início</label><input id='hora_inicio' name='hora_inicio' type='time' required /></div>" +
            "<div class='field'><label for='hora_fim'>Hora de término</label><input id='hora_fim' name='hora_fim' type='time' required value='" + localTime + "' /></div>" +
            "<div class='field'><label for='tipo_atividade'>Atividade</label><select id='tipo_atividade' name='tipo_atividade' required><option value=''>Selecione</option>" + options + "</select></div>" +
            "<div class='field'><label for='local'>Local</label><input id='local' name='local' required maxlength='160' placeholder='Informe o local' /></div>" +
            "<div class='field wide'><label for='observacao'>Observação</label><textarea id='observacao' name='observacao' maxlength='1000' placeholder='Opcional'></textarea></div>" +
          "</div>" +
          "<div class='notice notice-info'>Ao confirmar, o sistema usará automaticamente sua assinatura cadastrada e guardará uma cópia permanente neste registro.</div>" +
          "<div class='button-row'><button class='btn btn-primary' type='submit'>SALVAR E ASSINAR</button><button class='btn btn-secondary' type='button' data-route='inicio'>CANCELAR</button></div>" +
          "</div>" +
        "</form>" +
      "</section>";
    renderShell(html);
    ["hora_inicio", "hora_fim"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", updateDuration);
    });
  }

  function calculateDuration(start, end) {
    if (!start || !end) return 0;
    const a = start.split(":").map(Number);
    const b = end.split(":").map(Number);
    return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  }

  function updateDuration() {
    const start = document.getElementById("hora_inicio").value;
    const end = document.getElementById("hora_fim").value;
    const duration = calculateDuration(start, end);
    document.getElementById("duration-display").textContent = duration > 0 ? minutesLabel(duration) : "0 min";
  }

  async function saveAndSignActivity(form) {
    const data = Object.fromEntries(new FormData(form));
    const duration = calculateDuration(data.hora_inicio, data.hora_fim);
    if (duration <= 0) throw new Error("A hora de término deve ser posterior à hora de início.");

    const existing = await sb.from("activities")
      .select("id,status,local,created_at")
      .eq("user_id", state.profile.id)
      .eq("data", data.data)
      .eq("hora_inicio", data.hora_inicio)
      .eq("hora_fim", data.hora_fim)
      .eq("tipo_atividade", data.tipo_atividade)
      .order("created_at", { ascending: false });
    if (existing.error) throw existing.error;

    const normalizedLocal = data.local.trim().toLocaleLowerCase("pt-BR");
    const match = (existing.data || []).find(function (row) {
      return String(row.local || "").trim().toLocaleLowerCase("pt-BR") === normalizedLocal;
    });
    if (match && match.status === "ASSINADO") {
      throw new Error("Esta atividade já foi registrada e assinada.");
    }
    if (match) {
      await invokeActivitySignature(match.id);
      return match.id;
    }

    const inserted = await sb.from("activities").insert({
      user_id: state.profile.id,
      data: data.data,
      hora_inicio: data.hora_inicio,
      hora_fim: data.hora_fim,
      duracao_minutos: duration,
      tipo_atividade: data.tipo_atividade,
      local: data.local.trim(),
      observacao: data.observacao.trim() || null
    }).select("id").single();
    if (inserted.error) throw inserted.error;

    await invokeActivitySignature(inserted.data.id);
    return inserted.data.id;
  }

  async function invokeActivitySignature(activityId) {
    const signed = await sb.functions.invoke("sign-activity", { body: { activity_id: activityId } });
    if (signed.error) {
      let details = "";
      try { details = (await signed.error.context.json()).error || ""; } catch (_) {}
      throw new Error(details || signed.error.message);
    }
  }

  async function signExistingActivity(activityId) {
    await invokeActivitySignature(activityId);
    toast("Atividade assinada com sucesso.", "success");
    await renderHistory("mes");
  }

  function dedupeActivities(rows) {
    const unique = new Map();
    (rows || []).forEach(function (row) {
      const key = [row.user_id, row.data, row.hora_inicio, row.hora_fim, row.tipo_atividade,
        String(row.local || "").trim().toLocaleLowerCase("pt-BR")].join("|");
      const current = unique.get(key);
      if (!current || (row.status === "ASSINADO" && current.status !== "ASSINADO") ||
          (row.status === current.status && String(row.created_at || "") > String(current.created_at || ""))) {
        unique.set(key, row);
      }
    });
    return Array.from(unique.values());
  }

  async function renderHistory(range) {
    const selected = range || "mes";
    let start = firstDayOfMonth();
    let end = todayISO();
    const now = new Date();
    if (selected === "hoje") start = end;
    if (selected === "semana") {
      const day = now.getDay() || 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - day + 1);
      start = new Date(monday.getTime() - monday.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    let query = sb.from("activities")
      .select("*, activity_signatures(signature_snapshot_path,signature_hash)")
      .gte("data", start).lte("data", end)
      .order("data", { ascending: false }).order("hora_inicio", { ascending: false });
    const result = await query;
    if (result.error) throw result.error;
    state.activities = dedupeActivities(result.data || []);
    const list = state.activities.length ? state.activities.map(function (row) {
      return "<div class='activity-item'>" +
        "<button class='activity-open' data-detail='" + row.id + "'><span class='activity-date'>" + dateBR(row.data) + "</span>" +
        "<span class='activity-info'><strong>" + esc(row.tipo_atividade) + "</strong><span>" + esc(row.hora_inicio.slice(0,5)) + " — " + esc(row.hora_fim.slice(0,5)) + " · " + minutesLabel(row.duracao_minutos) + "</span></span></button>" +
        (row.status === "PENDENTE" ? "<button class='btn btn-primary btn-small' data-action='retry-sign' data-activity-id='" + row.id + "'>ASSINAR AGORA</button>" : statusBadge(row.status)) +
      "</div>";
    }).join("") : "<div class='empty'><strong>Nenhuma atividade no período</strong>Altere o filtro ou faça um novo registro.</div>";
    const html =
      "<section class='page'>" +
        pageHeading("HISTÓRICO", "Minhas atividades", "Registros visíveis somente para você e para o comandante.") +
        "<div class='quick-filters'>" +
          ["hoje","semana","mes"].map(function (item) {
            const labels = { hoje:"Hoje", semana:"Esta semana", mes:"Este mês" };
            return "<button class='filter-chip " + (selected === item ? "active" : "") + "' data-history-range='" + item + "'>" + labels[item] + "</button>";
          }).join("") +
          "<button class='filter-chip' data-action='custom-history'>Período personalizado</button>" +
        "</div>" +
        "<div class='activity-list'>" + list + "</div>" +
      "</section>";
    renderShell(html);
  }

  async function renderCustomHistory() {
    const html =
      "<section class='page'>" + pageHeading("HISTÓRICO", "Período personalizado", "") +
      "<form id='custom-history-form' class='panel'><div class='panel-body stack'><div class='form-grid'>" +
      "<div class='field'><label>Data inicial</label><input type='date' name='start' required /></div>" +
      "<div class='field'><label>Data final</label><input type='date' name='end' required max='" + todayISO() + "' /></div>" +
      "</div><div class='button-row'><button class='btn btn-primary' type='submit'>CONSULTAR</button><button class='btn btn-secondary' type='button' data-route='minhas-atividades'>VOLTAR</button></div></div></form></section>";
    renderShell(html);
  }

  async function queryCustomHistory(start, end) {
    const result = await sb.from("activities").select("*, activity_signatures(signature_snapshot_path,signature_hash)")
      .gte("data", start).lte("data", end).order("data", { ascending: false }).order("hora_inicio", { ascending: false });
    if (result.error) throw result.error;
    state.activities = dedupeActivities(result.data || []);
    const rows = state.activities.map(activityRow).join("");
    const html =
      "<section class='page'>" + pageHeading("HISTÓRICO", "Minhas atividades", dateBR(start) + " a " + dateBR(end)) +
      "<div class='button-row' style='margin-bottom:16px'><button class='btn btn-secondary' data-action='custom-history'>ALTERAR PERÍODO</button></div>" +
      "<section class='panel'><div class='table-wrap'><table><thead><tr><th>Data</th><th>Horário</th><th>Atividade</th><th>Duração</th><th>Status</th></tr></thead><tbody>" +
      (rows || "<tr><td colspan='5' class='empty'>Nenhum registro encontrado.</td></tr>") +
      "</tbody></table></div></section></section>";
    renderShell(html);
  }

  function activityRow(row) {
    return "<tr><td><button class='row-button' data-detail='" + row.id + "'>" + dateBR(row.data) + "</button></td>" +
      "<td>" + esc(row.hora_inicio.slice(0,5)) + " — " + esc(row.hora_fim.slice(0,5)) + "</td>" +
      "<td>" + esc(row.tipo_atividade) + "</td><td>" + minutesLabel(row.duracao_minutos) + "</td><td>" + statusBadge(row.status) + "</td></tr>";
  }

  async function renderSignature() {
    let current = "";
    if (state.profile.assinatura_path) {
      const signed = await sb.storage.from("signatures").createSignedUrl(state.profile.assinatura_path, 600);
      if (!signed.error) {
        current = "<div><h3>Assinatura atual</h3><div class='signature-preview'><img src='" + esc(signed.data.signedUrl) + "' alt='Assinatura cadastrada' /><div class='signature-line'>" + esc(state.profile.nome) + "</div></div></div>";
      }
    }
    const html =
      "<section class='page'>" +
        pageHeading("ASSINATURA", state.profile.assinatura_path ? "Minha assinatura" : "Cadastrar minha assinatura", "Desenhe com o dedo ou com o mouse.") +
        "<section class='panel'><div class='panel-body stack'>" +
          current +
          "<div><h3>" + (state.profile.assinatura_path ? "Alterar assinatura" : "Nova assinatura") + "</h3>" +
          "<div class='signature-pad-wrap'><canvas id='signature-pad' aria-label='Área para desenhar a assinatura'></canvas></div></div>" +
          "<div class='notice notice-info'>A alteração valerá apenas para registros futuros. As assinaturas já utilizadas permanecem inalteradas.</div>" +
          "<div class='button-row'><button class='btn btn-secondary' data-action='clear-signature'>LIMPAR</button><button class='btn btn-primary' data-action='save-signature'>SALVAR ASSINATURA</button></div>" +
        "</div></section>" +
      "</section>";
    renderShell(html);
    setupSignaturePad();
  }

  function setupSignaturePad() {
    const canvas = document.getElementById("signature-pad");
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(230 * ratio);
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#172b3a";
    let drawing = false;
    let drawn = false;
    function point(event) {
      const box = canvas.getBoundingClientRect();
      const source = event.touches ? event.touches[0] : event;
      return { x: source.clientX - box.left, y: source.clientY - box.top };
    }
    function start(event) {
      event.preventDefault(); drawing = true; drawn = true;
      const p = point(event); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    }
    function move(event) {
      if (!drawing) return;
      event.preventDefault(); const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    function end() { drawing = false; }
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: false });
    canvas.dataset.drawn = "false";
    canvas.addEventListener("pointermove", function () { if (drawn) canvas.dataset.drawn = "true"; });
  }

  async function saveSignature() {
    const canvas = document.getElementById("signature-pad");
    if (canvas.dataset.drawn !== "true") throw new Error("Desenhe sua assinatura antes de salvar.");
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
    const path = state.profile.id + "/current.png";
    const uploaded = await sb.storage.from("signatures").upload(path, blob, { contentType: "image/png", upsert: true });
    if (uploaded.error) throw uploaded.error;
    const saved = await sb.rpc("update_own_signature", { p_signature_path: path });
    if (saved.error) throw saved.error;
    state.profile.assinatura_path = path;
    toast("Assinatura salva com segurança.", "success");
    await renderSignature();
  }

  function clearSignature() {
    const canvas = document.getElementById("signature-pad");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.dataset.drawn = "false";
  }

  async function loadAdminData(filters) {
    let query = sb.from("activities")
      .select("*, profiles!activities_user_id_fkey(id,re,nome,graduacao,unidade), activity_signatures(signature_snapshot_path,signature_hash)")
      .order("data", { ascending: false }).order("hora_inicio", { ascending: false });
    if (filters && filters.start) query = query.gte("data", filters.start);
    if (filters && filters.end) query = query.lte("data", filters.end);
    if (filters && filters.type) query = query.eq("tipo_atividade", filters.type);
    const result = await query;
    if (result.error) throw result.error;
    let rows = dedupeActivities(result.data || []);
    if (filters && filters.search) {
      const term = filters.search.toLowerCase();
      rows = rows.filter(function (row) {
        const p = row.profiles || {};
        return String(p.nome || "").toLowerCase().includes(term) || String(p.re || "").toLowerCase().includes(term);
      });
    }
    if (filters && filters.unit) rows = rows.filter(function (row) { return (row.profiles || {}).unidade === filters.unit; });
    return rows;
  }

  async function loadProfiles() {
    const result = await sb.from("profiles").select("*").order("nome");
    if (result.error) throw result.error;
    state.profiles = result.data || [];
    return state.profiles;
  }

  function adminTable(rows) {
    if (!rows.length) return "<div class='empty'><strong>Nenhum registro encontrado</strong>Ajuste os filtros para consultar outro período.</div>";
    return "<div class='table-wrap'><table><thead><tr><th>Data</th><th>Hora</th><th>RE</th><th>Graduação</th><th>Policial</th><th>Atividade</th><th>Duração</th><th>Status</th><th>Assinatura</th></tr></thead><tbody>" +
      rows.map(function (row) {
        const p = row.profiles || {};
        const hasSignature = !!(row.activity_signatures && (Array.isArray(row.activity_signatures) ? row.activity_signatures.length : row.activity_signatures.signature_snapshot_path));
        return "<tr><td><button class='row-button' data-detail='" + row.id + "'>" + dateBR(row.data) + "</button></td>" +
          "<td>" + esc(row.hora_inicio.slice(0,5)) + "</td><td>" + esc(p.re) + "</td><td>" + esc(p.graduacao) + "</td><td>" + esc(p.nome) + "</td>" +
          "<td>" + esc(row.tipo_atividade) + "</td><td>" + minutesLabel(row.duracao_minutos) + "</td><td>" + statusBadge(row.status) + "</td><td>" + (hasSignature ? "Disponível" : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  async function renderAdminDashboard() {
    const profiles = await loadProfiles();
    const today = todayISO();
    const rows = await loadAdminData({ start: firstDayOfMonth(), end: today });
    state.activities = rows;
    const todayRows = rows.filter(function (row) { return row.data === today; });
    const signed = rows.filter(function (row) { return row.status === "ASSINADO"; }).length;
    const active = profiles.filter(function (p) { return p.ativo; });
    const completedIds = new Set(todayRows.map(function (row) { return row.user_id; }));
    const missing = active.filter(function (p) { return !completedIds.has(p.id); });
    const recent = rows.slice(0, 8);
    const html =
      "<section class='page'>" +
        pageHeading("VISÃO GERAL", "Controle de Atividade Física", "Acompanhamento do efetivo e dos registros.") +
        "<div class='cards'>" +
          metric("Efetivo total", active.length) + metric("Atividades hoje", todayRows.length) +
          metric("Atividades no período", rows.length) + metric("Registros assinados", signed) +
          metric("Registros pendentes", rows.length - signed) +
        "</div>" +
        "<section class='panel' style='margin-bottom:18px'><div class='panel-header'><h2>Registros recentes</h2><button class='btn btn-secondary btn-small' data-route='registros'>VER TODOS</button></div>" + adminTable(recent) + "</section>" +
        "<section class='panel'><div class='panel-header'><h2>Sem atividade hoje</h2><span class='role-chip'>" + missing.length + " policiais</span></div><div class='panel-body'>" +
          (missing.length ? "<div class='activity-list'>" + missing.map(function (p) {
            return "<div class='activity-item'><div class='activity-date'>RE " + esc(p.re) + "</div><div class='activity-info'><strong>" + esc(p.nome) + "</strong><span>" + esc(p.graduacao) + " · " + esc(p.unidade) + "</span></div><span class='status status-pending'>SEM REGISTRO</span></div>";
          }).join("") + "</div>" : "<div class='empty'><strong>Todos os policiais ativos possuem registro hoje</strong></div>") +
        "</div></section>" +
      "</section>";
    renderShell(html);
  }

  function metric(label, value) {
    return "<div class='metric'><div class='metric-label'>" + label + "</div><div class='metric-value'>" + value + "</div></div>";
  }

  function filterBar(id, includeUnit) {
    const options = activityTypes.map(function (item) { return "<option value='" + esc(item) + "'>" + esc(item) + "</option>"; }).join("");
    const units = Array.from(new Set(state.profiles.map(function (p) { return p.unidade; }).filter(Boolean))).sort();
    return "<form id='" + id + "' class='filters'>" +
      "<div class='field'><label>Nome ou RE</label><input name='search' placeholder='Pesquisar' /></div>" +
      "<div class='field'><label>Data inicial</label><input type='date' name='start' value='" + firstDayOfMonth() + "' /></div>" +
      "<div class='field'><label>Data final</label><input type='date' name='end' value='" + todayISO() + "' /></div>" +
      "<div class='field'><label>Atividade</label><select name='type'><option value=''>Todas</option>" + options + "</select></div>" +
      (includeUnit ? "<div class='field'><label>Unidade</label><select name='unit'><option value=''>Todas</option>" + units.map(function (u) { return "<option>" + esc(u) + "</option>"; }).join("") + "</select></div>" : "") +
      "<div class='field'><label>&nbsp;</label><button class='btn btn-primary' type='submit'>FILTRAR</button></div>" +
    "</form>";
  }

  async function renderRecords(filters) {
    if (!state.profiles.length) await loadProfiles();
    const rows = await loadAdminData(filters || { start: firstDayOfMonth(), end: todayISO() });
    state.activities = rows;
    const html =
      "<section class='page'>" +
        pageHeading("ADMINISTRAÇÃO", "Registros", rows.length + " registro(s) encontrado(s)") +
        "<section class='panel'>" + filterBar("records-filter", false) + adminTable(rows) + "</section>" +
      "</section>";
    renderShell(html);
  }

  async function renderPersonnel() {
    const profiles = await loadProfiles();
    const rows = profiles.map(function (p) {
      return "<tr><td>" + esc(p.re) + "</td><td>" + esc(p.nome) + "</td><td>" + esc(p.graduacao) + "</td><td>" + esc(p.unidade) + "</td><td>" +
        administrativeLabel(p) + "</td><td>" + (p.ativo ? "<span class='status status-signed'>ATIVO</span>" : "<span class='status status-pending'>INATIVO</span>") +
        "</td><td><button class='btn btn-secondary btn-small' data-action='toggle-profile' data-profile-id='" + p.id + "' data-current='" + p.ativo + "'>" + (p.ativo ? "INATIVAR" : "ATIVAR") + "</button></td></tr>";
    }).join("");
    const registerForm =
      "<form id='register-user-form' class='stack'><div class='form-grid'>" +
        field("RE", "re", "text", true) + field("Nome completo", "nome", "text", true) +
        field("Graduação", "graduacao", "text", true) + field("Companhia/unidade", "unidade", "text", true) +
        field("E-mail/login", "email", "email", false, "Opcional. Sem e-mail, o acesso será feito pelo RE.") +
        field("Senha inicial", "password", "password", true, "Mínimo de 8 caracteres.") +
        "<div class='field'><label>Perfil</label><select name='role' required><option value='policial'>Policial</option><option value='administrador'>Administrador</option><option value='comandante'>Comandante</option></select></div>" +
        "<div class='field'><label>Situação</label><select name='ativo'><option value='true'>Ativo</option><option value='false'>Inativo</option></select></div>" +
      "</div><div class='button-row'><button class='btn btn-primary' type='submit'>CADASTRAR USUÁRIO</button></div></form>";
    const batchForm =
      "<form id='batch-register-form' class='stack'>" +
        "<div class='notice notice-info'>Cole uma pessoa por linha no formato: <strong>RE | Nome completo | Graduação | Perfil</strong>. Use policial, administrador ou comandante. O e-mail é opcional e não será exigido.</div>" +
        "<div class='field'><label>Companhia/unidade para todos</label><input name='unidade' value='" + esc(state.profile.unidade || "") + "' required /></div>" +
        "<div class='field'><label>Lista do efetivo</label><textarea name='people' class='batch-input' required placeholder='127861-4 | Daniel Ferreira Lopes | Cap PM | comandante&#10;980131-6 | João Pedro Scapin | Subten PM | administrador'></textarea><span class='help'>O sistema criará uma senha provisória diferente para cada pessoa.</span></div>" +
        "<div class='button-row'><button class='btn btn-primary' type='submit'>CADASTRAR LISTA</button></div>" +
      "</form>";
    const batchResults = state.batchResults.length ?
      "<div id='batch-results' class='stack'><div class='notice notice-warning'><strong>Guarde estas senhas agora.</strong> Elas aparecem somente nesta tela.</div>" +
        "<div class='table-wrap'><table><thead><tr><th>RE</th><th>Nome</th><th>Resultado</th><th>Senha provisória</th></tr></thead><tbody>" +
          state.batchResults.map(function (item) {
            return "<tr><td>" + esc(item.re) + "</td><td>" + esc(item.nome) + "</td><td>" +
              (item.ok ? "<span class='status status-signed'>CADASTRADO</span>" : "<span class='status status-pending'>" + esc(item.error) + "</span>") +
              "</td><td><span class='code'>" + esc(item.password || "—") + "</span></td></tr>";
          }).join("") +
        "</tbody></table></div><div class='button-row'><button class='btn btn-secondary' type='button' data-action='copy-batch-results'>COPIAR RESULTADOS</button></div></div>" : "";
    const html =
      "<section class='page'>" +
        pageHeading("ADMINISTRAÇÃO", "Efetivo", profiles.length + " usuário(s) cadastrado(s)", "<div class='button-row'><button class='btn btn-secondary' data-action='open-register-user'>CADASTRAR UM</button><button class='btn btn-primary' data-action='open-batch-register'>CADASTRAR EM LOTE</button></div>") +
        "<section class='panel'><div class='table-wrap'><table><thead><tr><th>RE</th><th>Nome</th><th>Graduação</th><th>Unidade</th><th>Perfil</th><th>Situação</th><th>Ação</th></tr></thead><tbody>" + rows + "</tbody></table></div></section>" +
        "<div id='user-modal' hidden><div class='modal-backdrop'><section class='modal'><div class='modal-head'><h2>Cadastrar usuário</h2><button class='btn btn-secondary btn-small icon-button' data-action='close-modal' aria-label='Fechar'>×</button></div><div class='modal-body'>" + registerForm + "</div></section></div></div>" +
        "<div id='batch-modal' " + (state.batchResults.length ? "" : "hidden") + "><div class='modal-backdrop'><section class='modal modal-wide'><div class='modal-head'><h2>Cadastro em lote</h2><button class='btn btn-secondary btn-small icon-button' data-action='close-batch-modal' aria-label='Fechar'>×</button></div><div class='modal-body stack'>" + (batchResults || batchForm) + "</div></section></div></div>" +
      "</section>";
    renderShell(html);
  }

  function field(label, name, type, required, help) {
    return "<div class='field'><label>" + label + "</label><input name='" + name + "' type='" + type + "' " + (required ? "required" : "") + " />" +
      (help ? "<span class='help'>" + help + "</span>" : "") + "</div>";
  }

  async function invokeCreateUser(values) {
    const invoked = await sb.functions.invoke("create-user", {
      body: {
        re: values.re.trim(),
        nome: values.nome.trim(),
        graduacao: values.graduacao.trim(),
        unidade: values.unidade.trim(),
        email: String(values.email || "").trim() || null,
        password: values.password,
        role: values.role === "policial" ? "policial" : "comandante",
        ativo: values.ativo !== false && values.ativo !== "false"
      }
    });
    if (invoked.error) {
      let details = "";
      try { details = (await invoked.error.context.json()).error || ""; } catch (_) {}
      throw new Error(details || invoked.error.message);
    }
    return invoked.data;
  }

  async function createUser(form) {
    const values = Object.fromEntries(new FormData(form));
    await invokeCreateUser(values);
    toast("Usuário cadastrado. O login já pode ser utilizado.", "success");
    await renderPersonnel();
  }

  function temporaryPassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let password = "Aa7!";
    for (let i = 0; i < 8; i++) password += alphabet[bytes[i] % alphabet.length];
    return password;
  }

  function parseBatchLine(line, index, unidade) {
    const parts = line.split("|").map(function (part) { return part.trim(); });
    if (parts.length < 4 || parts.slice(0, 4).some(function (part) { return !part; })) {
      throw new Error("Linha " + (index + 1) + " incompleta");
    }
    const roleText = parts[3].normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const role = roleText === "policial" || roleText === "efetivo" ? "policial" :
      roleText === "administrador" || roleText === "comandante" ? roleText : "";
    if (!role) throw new Error("Perfil inválido na linha " + (index + 1));
    return { re: parts[0], nome: parts[1], graduacao: parts[2], unidade: unidade, role: role, ativo: true };
  }

  async function createUsersBatch(form) {
    const values = Object.fromEntries(new FormData(form));
    const lines = String(values.people || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) throw new Error("Cole pelo menos uma pessoa na lista.");
    const people = lines.map(function (line, index) { return parseBatchLine(line, index, String(values.unidade || "").trim()); });
    state.batchResults = [];
    for (const person of people) {
      const password = temporaryPassword();
      try {
        await invokeCreateUser(Object.assign({}, person, { password: password, email: "" }));
        state.batchResults.push({ re: person.re, nome: person.nome, password: password, ok: true });
      } catch (error) {
        state.batchResults.push({ re: person.re, nome: person.nome, password: "", ok: false, error: errorMessage(error) });
      }
    }
    await renderPersonnel();
    toast(state.batchResults.filter(function (item) { return item.ok; }).length + " usuário(s) cadastrado(s).", "success");
  }

  async function copyBatchResults() {
    const text = state.batchResults.map(function (item) {
      return item.re + " | " + item.nome + " | " + (item.ok ? item.password : "ERRO: " + item.error);
    }).join("\n");
    await navigator.clipboard.writeText(text);
    toast("Resultados copiados.", "success");
  }

  async function renderReports(filters) {
    if (!state.profiles.length) await loadProfiles();
    const activeFilters = filters || { start: firstDayOfMonth(), end: todayISO() };
    const rows = await loadAdminData(activeFilters);
    state.reportRows = rows;
    const html =
      "<section class='page'>" +
        pageHeading("DOCUMENTOS", "Relatórios", "Selecione o período e exporte os registros.") +
        "<section class='panel'>" + filterBar("report-filter", true) +
          "<div class='panel-header'><h2>Prévia do relatório</h2><div class='button-row no-print'><button class='btn btn-secondary btn-small' data-action='export-csv'>EXPORTAR CSV</button><button class='btn btn-primary btn-small' data-action='generate-pdf'>GERAR PDF</button><button class='btn btn-secondary btn-small' data-action='print'>IMPRIMIR</button></div></div>" +
          adminTable(rows) +
        "</section>" +
      "</section>";
    renderShell(html);
  }

  async function openDetail(id) {
    let row = state.activities.concat(state.reportRows).find(function (item) { return item.id === id; });
    if (!row) {
      const result = await sb.from("activities")
        .select("*, profiles!activities_user_id_fkey(id,re,nome,graduacao,unidade), activity_signatures(signature_snapshot_path,signature_hash)")
        .eq("id", id).single();
      if (result.error) throw result.error;
      row = result.data;
    }
    const p = row.profiles || state.profile;
    const signatureRecord = Array.isArray(row.activity_signatures) ? row.activity_signatures[0] : row.activity_signatures;
    let signature = "<div class='notice notice-warning'>Este registro ainda não possui assinatura.</div>";
    if (signatureRecord) {
      const url = await sb.storage.from("activity-signatures").createSignedUrl(signatureRecord.signature_snapshot_path, 300);
      if (!url.error) signature = "<div class='signature-preview'><img src='" + esc(url.data.signedUrl) + "' alt='Assinatura usada neste registro' /><div class='signature-line'>" + esc(p.nome) + "</div></div>";
    }
    const modal = document.createElement("div");
    modal.id = "detail-modal";
    modal.className = "modal-backdrop";
    modal.innerHTML =
      "<section class='modal'><div class='modal-head'><h2>ATIVIDADE REGISTRADA</h2><button class='btn btn-secondary btn-small icon-button' data-action='close-detail' aria-label='Fechar'>×</button></div><div class='modal-body stack'>" +
        "<div class='detail-grid'>" +
          detail("Graduação", p.graduacao) + detail("Policial", p.nome) + detail("RE", p.re) +
          detail("Data", dateBR(row.data)) + detail("Início", row.hora_inicio.slice(0,5)) + detail("Término", row.hora_fim.slice(0,5)) +
          detail("Duração", minutesLabel(row.duracao_minutos)) + detail("Atividade", row.tipo_atividade) + detail("Local", row.local) +
          detail("Assinado em", dateTimeBR(row.signed_at)) + detail("Status", row.status) + detail("ID", row.id) +
        "</div>" +
        (row.observacao ? "<div class='detail'><div class='detail-label'>Observação</div><div class='detail-value'>" + esc(row.observacao) + "</div></div>" : "") +
        "<div><h3>Assinatura utilizada</h3>" + signature + "</div>" +
      "</div></section>";
    document.body.appendChild(modal);
  }

  function detail(label, value) {
    return "<div class='detail'><div class='detail-label'>" + esc(label) + "</div><div class='detail-value'>" + esc(value || "—") + "</div></div>";
  }

  async function signedImageData(path) {
    if (!path) return null;
    const downloaded = await sb.storage.from("activity-signatures").download(path);
    if (downloaded.error) return null;
    return await new Promise(function (resolve) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.readAsDataURL(downloaded.data);
    });
  }

  async function generatePDF() {
    const signedRows = dedupeActivities(state.reportRows).filter(function (row) { return row.status === "ASSINADO"; });
    if (!signedRows.length) throw new Error("Nenhum registro assinado no período. Assine a atividade antes de gerar o PDF.");
    toast("Preparando o PDF com as assinaturas…");
    const images = [];
    for (const row of signedRows) {
      const sig = Array.isArray(row.activity_signatures) ? row.activity_signatures[0] : row.activity_signatures;
      images.push(await signedImageData(sig && sig.signature_snapshot_path));
    }
    const jspdf = window.jspdf;
    const doc = new jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text("CONTROLE DE ATIVIDADE FÍSICA DO EFETIVO", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const dates = signedRows.map(function (r) { return r.data; }).sort();
    doc.text("Período: " + dateBR(dates[0]) + " até " + dateBR(dates[dates.length - 1]), 14, 21);
    doc.text("Documento de controle administrativo interno", 14, 26);
    const body = signedRows.map(function (row) {
      const p = row.profiles || {};
      return [dateBR(row.data), row.hora_inicio.slice(0,5), p.re || "", p.graduacao || "", p.nome || "", row.tipo_atividade, minutesLabel(row.duracao_minutos), ""];
    });
    doc.autoTable({
      startY: 31,
      head: [["Data","Hora","RE","Graduação","Nome","Atividade","Duração","Assinatura"]],
      body: body,
      styles: { fontSize: 7.2, cellPadding: 2.2, minCellHeight: 16, valign: "middle" },
      headStyles: { fillColor: [18,52,77] },
      columnStyles: { 3: { cellWidth: 25 }, 4: { cellWidth: 43 }, 5: { cellWidth: 34 }, 7: { cellWidth: 42 } },
      didDrawCell: function (data) {
        if (data.section === "body" && data.column.index === 7 && images[data.row.index]) {
          try { doc.addImage(images[data.row.index], "PNG", data.cell.x + 2, data.cell.y + 2, data.cell.width - 4, data.cell.height - 4, undefined, "FAST"); } catch (_) {}
        }
      }
    });
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(100);
      doc.text("Página " + i + " de " + pages, 282, 202, { align: "right" });
    }
    doc.save("relatorio-atividade-fisica-" + todayISO() + ".pdf");
  }

  function exportCSV() {
    if (!state.reportRows.length) throw new Error("Não há registros para exportar.");
    const header = ["ID","Data","Início","Término","Duração (min)","RE","Nome","Graduação","Unidade","Atividade","Local","Observação","Status","Assinado em"];
    const lines = [header].concat(state.reportRows.map(function (row) {
      const p = row.profiles || {};
      return [row.id,row.data,row.hora_inicio,row.hora_fim,row.duracao_minutos,p.re,p.nome,p.graduacao,p.unidade,row.tipo_atividade,row.local,row.observacao || "",row.status,row.signed_at || ""];
    })).map(function (cells) {
      return cells.map(function (cell) { return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"'; }).join(";");
    });
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "atividades-" + todayISO() + ".csv"; a.click();
    URL.revokeObjectURL(a.href);
  }

  async function loadProfile() {
    const result = await sb.from("profiles").select("*").eq("auth_user_id", state.session.user.id).single();
    if (result.error) throw result.error;
    if (!result.data.ativo) {
      await sb.auth.signOut();
      throw new Error("Seu acesso está inativo. Procure o administrador.");
    }
    state.profile = result.data;
    state.route = isCommander() ? "painel" : "inicio";
  }

  async function navigate(route) {
    const allowed = isCommander()
      ? ["painel","inicio","registrar","minhas-atividades","assinatura","registros","efetivo","relatorios"]
      : ["inicio","registrar","minhas-atividades","assinatura"];
    state.route = allowed.includes(route) ? route : allowed[0];
    window.location.hash = state.route;
    try {
      if (state.route === "inicio") renderHome();
      if (state.route === "registrar") renderActivityForm();
      if (state.route === "minhas-atividades") await renderHistory();
      if (state.route === "assinatura") await renderSignature();
      if (state.route === "painel") await renderAdminDashboard();
      if (state.route === "registros") await renderRecords();
      if (state.route === "efetivo") await renderPersonnel();
      if (state.route === "relatorios") await renderReports();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  async function boot() {
    if (!configured) { renderSetup(); return; }
    if (!window.supabase) { root.innerHTML = "<div class='config-screen notice notice-danger'>Não foi possível carregar o módulo de conexão segura.</div>"; return; }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !recoveryLinkRequested }
    });
    sb.auth.onAuthStateChange(function (event, session) {
      if ((event === "PASSWORD_RECOVERY" || recoveryLinkRequested) && session) {
        state.session = session;
        renderResetPassword();
        return;
      }
      if (event === "SIGNED_OUT") {
        state.session = null;
        state.profile = null;
        renderLogin();
      }
    });
    if (recoveryAccessToken && recoveryRefreshToken) {
      const restored = await sb.auth.setSession({
        access_token: recoveryAccessToken,
        refresh_token: recoveryRefreshToken
      });
      if (restored.error) throw restored.error;
    } else if (recoveryCode) {
      const exchanged = await sb.auth.exchangeCodeForSession(recoveryCode);
      if (exchanged.error) throw exchanged.error;
    }
    const current = await sb.auth.getSession();
    state.session = current.data.session;
    if (recoveryLinkRequested && state.session) { renderResetPassword(); }
    else if (!state.session) { renderLogin(); }
    else {
      try { await loadProfile(); await navigate(window.location.hash.slice(1) || state.route); }
      catch (error) { toast(errorMessage(error), "error"); renderLogin(); }
    }
    registerWebMCP();
  }

  root.addEventListener("click", async function (event) {
    const route = event.target.closest("[data-route]");
    const action = event.target.closest("[data-action]");
    const detailTarget = event.target.closest("[data-detail]");
    const range = event.target.closest("[data-history-range]");
    try {
      if (route) { await navigate(route.dataset.route); return; }
      if (detailTarget) { await openDetail(detailTarget.dataset.detail); return; }
      if (range) { await renderHistory(range.dataset.historyRange); return; }
      if (!action) return;
      const name = action.dataset.action;
      if (name === "logout") await sb.auth.signOut();
      if (name === "forgot-password") renderRecoveryRequest();
      if (name === "back-login") renderLogin();
      if (name === "clear-signature") clearSignature();
      if (name === "save-signature") { setBusy(true); await saveSignature(); setBusy(false); }
      if (name === "custom-history") await renderCustomHistory();
      if (name === "open-register-user") document.getElementById("user-modal").hidden = false;
      if (name === "close-modal") document.getElementById("user-modal").hidden = true;
      if (name === "open-batch-register") {
        state.batchResults = [];
        document.getElementById("batch-modal").hidden = false;
      }
      if (name === "close-batch-modal") {
        state.batchResults = [];
        document.getElementById("batch-modal").hidden = true;
      }
      if (name === "copy-batch-results") await copyBatchResults();
      if (name === "retry-sign") {
        setBusy(true);
        await signExistingActivity(action.dataset.activityId);
        setBusy(false);
      }
      if (name === "close-detail") document.getElementById("detail-modal").remove();
      if (name === "toggle-profile") {
        const next = action.dataset.current !== "true";
        const changed = await sb.rpc("set_profile_status", { p_profile_id: action.dataset.profileId, p_active: next });
        if (changed.error) throw changed.error;
        toast(next ? "Acesso ativado." : "Acesso inativado.", "success");
        await renderPersonnel();
      }
      if (name === "export-csv") exportCSV();
      if (name === "generate-pdf") { setBusy(true); await generatePDF(); setBusy(false); }
      if (name === "print") window.print();
      if (name === "install" && installPrompt) {
        installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
      }
    } catch (error) {
      setBusy(false);
      toast(errorMessage(error), "error");
    }
  });

  root.addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.target;
    try {
      setBusy(true);
      if (form.id === "login-form") {
        const values = Object.fromEntries(new FormData(form));
        let session;
        if (String(values.login).includes("@")) {
          const result = await sb.auth.signInWithPassword({ email: normalizeLogin(values.login), password: values.password });
          if (result.error) throw result.error;
          session = result.data.session;
        } else {
          const result = await sb.functions.invoke("login-with-re", {
            body: { re: values.login, password: values.password }
          });
          if (result.error) {
            let details = "";
            try { details = (await result.error.context.json()).error || ""; } catch (_) {}
            throw new Error(details || "RE ou senha incorretos.");
          }
          session = result.data.session;
          const restored = await sb.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
          });
          if (restored.error) throw restored.error;
        }
        state.session = session;
        await loadProfile();
        await navigate(state.route);
      }
      if (form.id === "recovery-request-form") {
        const values = Object.fromEntries(new FormData(form));
        const result = await sb.auth.resetPasswordForEmail(String(values.email || "").trim(), {
          redirectTo: window.location.origin
        });
        if (result.error) throw result.error;
        renderLogin();
        toast("E-mail de recuperação enviado. Verifique também a caixa de spam.", "success");
      }
      if (form.id === "reset-password-form") {
        const values = Object.fromEntries(new FormData(form));
        if (String(values.password).length < 8) throw new Error("A nova senha deve ter pelo menos 8 caracteres.");
        if (values.password !== values.confirmation) throw new Error("As senhas digitadas não são iguais.");
        const result = await sb.auth.updateUser({ password: String(values.password) });
        if (result.error) throw result.error;
        window.history.replaceState({}, document.title, window.location.pathname);
        await sb.auth.signOut();
        renderLogin();
        toast("Senha alterada com sucesso. Entre usando a nova senha.", "success");
      }
      if (form.id === "activity-form") {
        const id = await saveAndSignActivity(form);
        toast("Atividade registrada e assinada.", "success");
        state.route = "minhas-atividades";
        await renderHistory("mes");
        await openDetail(id);
      }
      if (form.id === "custom-history-form") {
        const values = Object.fromEntries(new FormData(form));
        if (values.end < values.start) throw new Error("A data final deve ser igual ou posterior à data inicial.");
        await queryCustomHistory(values.start, values.end);
      }
      if (form.id === "records-filter") {
        const v = Object.fromEntries(new FormData(form));
        await renderRecords(v);
      }
      if (form.id === "report-filter") {
        const v = Object.fromEntries(new FormData(form));
        await renderReports(v);
      }
      if (form.id === "register-user-form") await createUser(form);
      if (form.id === "batch-register-form") await createUsersBatch(form);
      setBusy(false);
    } catch (error) {
      setBusy(false);
      toast(errorMessage(error), "error");
    }
  });

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    installPrompt = event;
  });

  window.addEventListener("hashchange", function () {
    if (state.profile) navigate(window.location.hash.slice(1));
  });

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context || !context.registerTool) return;
    try {
      context.registerTool({
        name: "start_activity_registration",
        title: "Iniciar registro de atividade",
        description: "Abre a tela para o policial autenticado registrar e assinar a própria atividade.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async function () {
          if (!state.profile || isCommander()) throw new Error("Ação disponível somente para policial autenticado.");
          await navigate("registrar");
          return { status: "ready", route: "registrar" };
        }
      });
    } catch (_) {}
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("./service-worker.js").catch(function () {}); });
  }

  boot().catch(function (error) {
    root.innerHTML = "<div class='config-screen notice notice-danger'>" + esc(errorMessage(error)) + "</div>";
  });
})();

