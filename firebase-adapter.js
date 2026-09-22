(function () {
  "use strict";

  const cfg = (window.APP_CONFIG && window.APP_CONFIG.FIREBASE_CONFIG) || {};
  if (!window.firebase) throw new Error("Firebase SDK não carregado.");
  if (!firebase.apps.length) firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const authReady = new Promise(function (resolve) {
    const stop = auth.onAuthStateChanged(function () { stop(); resolve(); });
  });

  function sessionFromUser(user) {
    return user ? { user: { id: user.uid, uid: user.uid, email: user.email || "" } } : null;
  }

  function iso(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function signatureKey(uid) { return "caf-signature:" + uid; }

  async function getCurrentProfile() {
    const user = auth.currentUser;
    if (!user) return null;
    const snap = await db.collection("usuarios").doc(user.uid).get();
    if (!snap.exists) return null;
    const data = Object.assign({ id: snap.id, auth_user_id: snap.id }, snap.data());
    if (localStorage.getItem(signatureKey(user.uid))) data.assinatura_path = user.uid + "/current.png";
    return data;
  }

  async function profileByUid(uid) {
    const snap = await db.collection("usuarios").doc(uid).get();
    if (!snap.exists) return null;
    const data = Object.assign({ id: snap.id, auth_user_id: snap.id }, snap.data());
    if (localStorage.getItem(signatureKey(uid))) data.assinatura_path = uid + "/current.png";
    return data;
  }

  async function isManager() {
    const p = await getCurrentProfile();
    return !!(p && p.ativo && ["administrador", "comandante"].includes(String(p.role || "").toLowerCase()));
  }

  async function activityFromDoc(doc, includeProfile) {
    const d = doc.data();
    const row = Object.assign({}, d, {
      id: doc.id,
      user_id: d.userUid,
      created_at: iso(d.createdAt),
      signed_at: iso(d.signedAt)
    });
    if (d.signatureData) {
      row.activity_signatures = {
        signature_snapshot_path: "activity:" + doc.id,
        signature_hash: d.signatureHash || "embedded"
      };
    } else {
      row.activity_signatures = null;
    }
    if (includeProfile && d.userUid) row.profiles = await profileByUid(d.userUid);
    return row;
  }

  class QueryBuilder {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.orders = [];
      this.wantSingle = false;
      this.insertPayload = null;
      this.includeProfile = false;
    }
    select(text) {
      this.includeProfile = /profiles/i.test(text || "");
      return this;
    }
    eq(field, value) { this.filters.push(["eq", field, value]); return this; }
    gte(field, value) { this.filters.push(["gte", field, value]); return this; }
    lte(field, value) { this.filters.push(["lte", field, value]); return this; }
    order(field, options) { this.orders.push([field, !(options && options.ascending === false)]); return this; }
    single() { this.wantSingle = true; return this; }
    insert(payload) { this.insertPayload = payload; return this; }
    then(resolve, reject) { return this.execute().then(resolve, reject); }

    async execute() {
      try {
        if (this.insertPayload) return await this.executeInsert();
        if (this.table === "profiles") return await this.executeProfiles();
        if (this.table === "activities") return await this.executeActivities();
        return { data: null, error: new Error("Coleção não suportada: " + this.table) };
      } catch (error) { return { data: null, error: error }; }
    }

    async executeInsert() {
      if (this.table !== "activities") throw new Error("Inserção não suportada nesta coleção.");
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      const p = this.insertPayload || {};
      const currentSignature = localStorage.getItem(signatureKey(user.uid));
      if (!currentSignature) throw new Error("Cadastre sua assinatura antes de registrar a atividade.");
      const payload = {
        userUid: user.uid,
        data: p.data,
        hora_inicio: p.hora_inicio,
        hora_fim: p.hora_fim,
        duracao_minutos: Number(p.duracao_minutos || 0),
        tipo_atividade: p.tipo_atividade,
        local: p.local,
        observacao: p.observacao || null,
        status: "PENDENTE",
        signatureData: currentSignature,
        signatureHash: "snapshot-v1",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const ref = await db.collection("atividades").add(payload);
      const data = { id: ref.id };
      return { data: data, error: null };
    }

    async executeProfiles() {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      let rows = [];
      const manager = await isManager();
      if (manager) {
        const snap = await db.collection("usuarios").get();
        rows = snap.docs.map(function (d) {
          const x = Object.assign({ id: d.id, auth_user_id: d.id }, d.data());
          if (localStorage.getItem(signatureKey(d.id))) x.assinatura_path = d.id + "/current.png";
          return x;
        });
      } else {
        const p = await profileByUid(user.uid);
        if (p) rows = [p];
      }
      rows = applyFilters(rows, this.filters);
      rows = applyOrders(rows, this.orders);
      if (this.wantSingle) return { data: rows[0] || null, error: rows.length ? null : new Error("Usuário não encontrado.") };
      return { data: rows, error: null };
    }

    async executeActivities() {
      const user = auth.currentUser;
      if (!user) throw new Error("Sessão expirada.");
      const manager = await isManager();
      let ref = db.collection("atividades");
      if (!manager) ref = ref.where("userUid", "==", user.uid);
      const snap = await ref.get();
      let rows = [];
      for (const doc of snap.docs) rows.push(await activityFromDoc(doc, this.includeProfile || manager));
      rows = applyFilters(rows, this.filters.map(function (f) {
        const copy = f.slice();
        if (copy[1] === "user_id") copy[1] = "user_id";
        if (copy[1] === "id") copy[1] = "id";
        return copy;
      }));
      rows = applyOrders(rows, this.orders);
      if (this.wantSingle) return { data: rows[0] || null, error: rows.length ? null : new Error("Registro não encontrado.") };
      return { data: rows, error: null };
    }
  }

  function applyFilters(rows, filters) {
    return rows.filter(function (row) {
      return filters.every(function (f) {
        const op = f[0], field = f[1], value = f[2];
        const current = row[field];
        if (op === "eq") return String(current == null ? "" : current) === String(value == null ? "" : value);
        if (op === "gte") return String(current || "") >= String(value || "");
        if (op === "lte") return String(current || "") <= String(value || "");
        return true;
      });
    });
  }

  function applyOrders(rows, orders) {
    if (!orders.length) return rows;
    return rows.slice().sort(function (a, b) {
      for (const item of orders) {
        const field = item[0], asc = item[1];
        const av = a[field] == null ? "" : a[field];
        const bv = b[field] == null ? "" : b[field];
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
      }
      return 0;
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function signActivity(activityId) {
    const user = auth.currentUser;
    if (!user) throw new Error("Sessão expirada.");
    const ref = db.collection("atividades").doc(activityId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Atividade não encontrada.");
    const d = snap.data();
    if (d.userUid !== user.uid) throw new Error("Você só pode assinar a própria atividade.");
    if (d.status === "ASSINADO") return { ok: true };
    await ref.update({ status: "ASSINADO", signedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { ok: true };
  }

  function normalizeReEmail(re) {
    const normalized = String(re || "").trim().replace(/[^0-9a-z]/gi, "").toLowerCase();
    const map = (window.APP_CONFIG && window.APP_CONFIG.RE_EMAIL_MAP) || {};
    return map[String(re || "").trim()] || map[normalized] || ("re." + normalized + "@controle-interno.local");
  }

  const adapter = {
    from: function (table) {
      if (table === "profiles") return new QueryBuilder("profiles");
      if (table === "activities") return new QueryBuilder("activities");
      return new QueryBuilder(table);
    },
    auth: {
      onAuthStateChange: function (callback) {
        return auth.onAuthStateChanged(function (user) {
          callback(user ? "SIGNED_IN" : "SIGNED_OUT", sessionFromUser(user));
        });
      },
      getSession: async function () { await authReady; return { data: { session: sessionFromUser(auth.currentUser) }, error: null }; },
      signInWithPassword: async function (params) {
        try {
          const cred = await auth.signInWithEmailAndPassword(params.email, params.password);
          return { data: { session: sessionFromUser(cred.user) }, error: null };
        } catch (e) { return { data: null, error: e }; }
      },
      signOut: async function () { await auth.signOut(); return { error: null }; },
      resetPasswordForEmail: async function (email) {
        try { await auth.sendPasswordResetEmail(email); return { data: {}, error: null }; }
        catch (e) { return { data: null, error: e }; }
      },
      updateUser: async function (params) {
        try {
          if (!auth.currentUser) throw new Error("Sessão expirada.");
          if (params.password) await auth.currentUser.updatePassword(params.password);
          return { data: { user: auth.currentUser }, error: null };
        } catch (e) { return { data: null, error: e }; }
      },
      setSession: async function () { return { data: { session: sessionFromUser(auth.currentUser) }, error: null }; },
      exchangeCodeForSession: async function () { return { data: { session: sessionFromUser(auth.currentUser) }, error: null }; }
    },
    functions: {
      invoke: async function (name, options) {
        try {
          const body = (options && options.body) || {};
          if (name === "sign-activity") return { data: await signActivity(body.activity_id), error: null };
          if (name === "login-with-re") {
            const email = normalizeReEmail(body.re);
            const cred = await auth.signInWithEmailAndPassword(email, body.password);
            return { data: { session: sessionFromUser(cred.user) }, error: null };
          }
          if (name === "create-user") {
            if (!(await isManager())) throw new Error("Apenas administrador pode cadastrar usuário.");
            const p = body;
            const loginEmail = String(p.email || "").trim() || normalizeReEmail(p.re);
            let secondary = firebase.apps.find(function (a) { return a.name === "secondary"; });
            if (!secondary) secondary = firebase.initializeApp(cfg, "secondary");
            const secondaryAuth = secondary.auth();
            const cred = await secondaryAuth.createUserWithEmailAndPassword(loginEmail, p.password);
            const uid = cred.user.uid;
            await db.collection("usuarios").doc(uid).set({
              ativo: p.ativo !== false,
              email: String(p.email || "").trim() || loginEmail,
              graduacao: p.graduacao,
              nome: p.nome,
              re: p.re,
              role: p.role || "policial",
              uid: uid,
              unidade: p.unidade
            });
            await secondaryAuth.signOut();
            return { data: { uid: uid }, error: null };
          }
          throw new Error("Função não suportada: " + name);
        } catch (e) {
          return { data: null, error: { message: e.message || String(e), context: { json: async function () { return { error: e.message || String(e) }; } } } };
        }
      }
    },
    storage: {
      from: function (bucket) {
        return {
          upload: async function (path, blob) {
            try {
              if (bucket !== "signatures") throw new Error("Bucket não suportado.");
              const user = auth.currentUser;
              if (!user) throw new Error("Sessão expirada.");
              const dataUrl = await blobToDataURL(blob);
              localStorage.setItem(signatureKey(user.uid), dataUrl);
              return { data: { path: path }, error: null };
            } catch (e) { return { data: null, error: e }; }
          },
          createSignedUrl: async function (path) {
            try {
              if (bucket === "signatures") {
                const uid = String(path || "").split("/")[0];
                const dataUrl = localStorage.getItem(signatureKey(uid));
                if (!dataUrl) throw new Error("Assinatura não encontrada neste dispositivo.");
                return { data: { signedUrl: dataUrl }, error: null };
              }
              if (bucket === "activity-signatures" && String(path || "").startsWith("activity:")) {
                const id = String(path).slice("activity:".length);
                const snap = await db.collection("atividades").doc(id).get();
                if (!snap.exists || !snap.data().signatureData) throw new Error("Assinatura do registro não encontrada.");
                return { data: { signedUrl: snap.data().signatureData }, error: null };
              }
              throw new Error("Assinatura não encontrada.");
            } catch (e) { return { data: null, error: e }; }
          }
        };
      }
    },
    rpc: async function (name, params) {
      try {
        if (name === "update_own_signature") return { data: true, error: null };
        if (name === "set_profile_status") {
          if (!(await isManager())) throw new Error("Acesso negado.");
          await db.collection("usuarios").doc(params.p_profile_id).update({ ativo: !!params.p_active });
          return { data: true, error: null };
        }
        throw new Error("Operação não suportada: " + name);
      } catch (e) { return { data: null, error: e }; }
    }
  };

  window.supabase = { createClient: function () { return adapter; } };
})();
