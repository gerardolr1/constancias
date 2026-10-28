(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.CONSTANCIAS_CONFIG || {};
  const LS_CODIGO = "constancias-codigo", LS_CAT = "constancias-catalogo";

  let codigo = "", rol = null, isAdmin = false;
  let rows = [], acts = [], catalogo = [], activa = "", totalCat = 0, filtro = "todos";
  let editId = null, armDelete = false, elegido = null, manual = false, armAct = null, ultimo = null;
  let pollTimer = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- Supabase (funciones c_* del archivo instalar.sql) ---------- */
  async function rpc(fn, args) {
    const res = await fetch(CFG.supabaseUrl + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: "Bearer " + CFG.supabaseKey },
      body: JSON.stringify(Object.assign({ p: codigo }, args || {}))
    });
    const txt = await res.text();
    const body = txt ? JSON.parse(txt) : null;
    if (!res.ok) { const e = new Error((body && body.message) || "error"); e.code = e.message; throw e; }
    return body;
  }

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400);
  }
  function banner(msg) { $("banner").textContent = msg; $("banner").hidden = !msg; }
  function hoy() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fechaBonita(s) {
    if (!s) return "";
    const [y, m, d] = s.split("-").map(Number);
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return d + " " + meses[m - 1] + " " + y;
  }
  function folio(n) { return "FOLIO " + String(n || 0).padStart(4, "0"); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
  function msgError(e) {
    if (e && e.code === "duplicado") return "Este alumno ya está registrado en esa actividad.";
    if (e && e.code === "acceso") return "El código ya no es válido. Vuelve a entrar.";
    return "No se pudo guardar. Revisa tu conexión e intenta de nuevo.";
  }

  // Búsqueda tolerante al dictado: sin acentos ni mayúsculas, palabras en cualquier orden,
  // y números de control aunque lleguen con espacios ("22 CG 0133").
  function buscarCat(qRaw, max) {
    const q = norm(qRaw).replace(/[.,;:]/g, " ");
    if (q.length < 2) return [];
    const qc = q.replace(/[\s-]/g, "");
    const toks = q.split(/\s+/).filter(Boolean);
    const res = [];
    for (const a of catalogo) {
      let score = 0;
      if (qc.length >= 3 && a._c.includes(qc)) score = 3;
      else if (toks.every(t => a._t.some(w => w.startsWith(t)))) score = a._t[0].startsWith(toks[0]) ? 2 : 1;
      if (score) res.push([score, a]);
    }
    res.sort((x, y) => y[0] - x[0]);
    return res.slice(0, max).map(x => x[1]);
  }
  function yaRegistrado(a, act) {
    return rows.find(r => r.actividad === act && (a.c ? r.control === a.c : norm(r.nombre) === norm(a.n)));
  }
  function carreraDe(r) { return r.carrera || ((catalogo.find(a => r.control && a.c === r.control) || {}).ca || ""); }

  /* ---------- Entrada con código ---------- */
  async function entrar(c, silencioso) {
    codigo = c;
    try {
      rol = await rpc("c_verificar");
    } catch (e) {
      rol = null;
      if (!silencioso) { $("lerr").textContent = "No hay conexión con la base de datos. Intenta de nuevo."; $("lerr").hidden = false; }
      return false;
    }
    if (!rol) {
      codigo = ""; lsSet(LS_CODIGO, null);
      if (!silencioso) { $("lerr").textContent = "Código incorrecto."; $("lerr").hidden = false; }
      return false;
    }
    isAdmin = rol === "admin";
    lsSet(LS_CODIGO, c);
    $("lock").hidden = true; $("app").hidden = false;
    $("tabs").hidden = !isAdmin;
    $("add").hidden = false;
    usarCatalogo(JSON.parse(lsGet(LS_CAT) || "[]"));
    await refrescar();
    cargarCatalogo();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) refrescar(); }, 8000);
    return true;
  }
  $("lockform").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("lerr").hidden = true; $("lbtn").disabled = true;
    await entrar($("lcode").value.trim(), false);
    $("lbtn").disabled = false;
  });
  $("salir").onclick = () => {
    lsSet(LS_CODIGO, null); lsSet(LS_CAT, null);
    clearInterval(pollTimer); location.reload();
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && rol) refrescar(); });

  async function refrescar() {
    try {
      const d = await rpc("c_datos");
      rows = d.registros || []; acts = d.actividades || []; activa = d.activa || ""; totalCat = d.alumnos || 0;
      if (d.rol !== rol) { rol = d.rol; isAdmin = rol === "admin"; $("tabs").hidden = !isAdmin; }
      banner("");
      render();
      if (totalCat !== catalogo.length) cargarCatalogo();
    } catch (e) {
      if (e.code === "acceso") { lsSet(LS_CODIGO, null); location.reload(); return; }
      banner("Sin conexión. Los datos se actualizarán al volver la señal.");
    }
  }
  function usarCatalogo(lista) {
    catalogo = lista.map(a => {
      const n = String(a.n || "");
      return { c: String(a.c || ""), n, ca: String(a.ca || ""), _c: norm(a.c), _t: norm(n).split(/\s+/) };
    });
    renderAdmin(); renderQuick();
  }
  async function cargarCatalogo() {
    try {
      const lista = await rpc("c_catalogo");
      lsSet(LS_CAT, JSON.stringify(lista));
      usarCatalogo(lista);
    } catch (e) {}
  }

  /* ---------- Pestañas ---------- */
  function tab(which) {
    const adm = which === "adm";
    $("t-reg").setAttribute("aria-selected", String(!adm));
    $("t-adm").setAttribute("aria-selected", String(adm));
    $("v-reg").hidden = adm; $("v-adm").hidden = !adm;
    $("add").hidden = adm;
  }
  $("t-reg").onclick = () => tab("reg");
  $("t-adm").onclick = () => tab("adm");

  /* ---------- Registros ---------- */
  function render() {
    const pend = rows.filter(r => r.estado !== "entregada").length;
    $("n-todos").textContent = rows.length;
    $("n-pend").textContent = pend;
    $("n-ok").textContent = rows.length - pend;
    $("csv").hidden = rows.length === 0;

    const fa = $("fact"), sel = fa.value;
    const nombres = [...new Set(acts.map(a => a.nombre).concat(rows.map(r => r.actividad)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    fa.replaceChildren(new Option("Todas las actividades", ""), ...nombres.map(n => new Option(n, n)));
    fa.value = nombres.includes(sel) ? sel : "";

    const q = norm($("q").value);
    const vis = rows.filter(r =>
      (filtro === "todos" || (filtro === "entregada" ? r.estado === "entregada" : r.estado !== "entregada")) &&
      (!fa.value || r.actividad === fa.value) &&
      (!q || norm(r.nombre + " " + r.control).includes(q)));

    const list = $("list");
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><strong>Aún no hay alumnos registrados</strong>Busca un alumno arriba o toca “+ Registrar alumno”.</div>';
    } else if (!vis.length) {
      list.innerHTML = '<div class="empty"><strong>Sin resultados</strong>Prueba con otra búsqueda o cambia el filtro.</div>';
    } else list.replaceChildren(...vis.slice(0, 200).map(card));
    renderAdmin();
    renderQuick();
  }

  function card(r) {
    const el = document.createElement("article"); el.className = "card";
    const ok = r.estado === "entregada";
    el.innerHTML = `
      <div class="card-top">
        <div style="min-width:0"><div class="folio"></div><h3></h3></div>
        <span class="pill ${ok ? "ok" : "pend"}">${ok ? "Entregada" : "Pendiente"}</span>
      </div>
      <div class="meta"></div>
      <p class="notes" hidden></p>
      <div class="actions">
        <button class="btn ${ok ? "" : "primary"}" data-a="toggle">${ok ? "Marcar pendiente" : "Marcar entregada"}</button>
        <button class="btn" data-a="edit">Editar</button>
      </div>`;
    el.querySelector(".folio").textContent = folio(r.folio);
    el.querySelector("h3").textContent = r.nombre;
    const meta = el.querySelector(".meta");
    [[r.actividad, "act"], [r.control && "No. control " + r.control], [fechaBonita(r.fecha)]]
      .filter(x => x[0]).forEach(([t, c]) => { const s = document.createElement("span"); s.textContent = t; if (c) s.className = c; meta.appendChild(s); });
    if (r.notas) { const n = el.querySelector(".notes"); n.textContent = r.notas; n.hidden = false; }
    el.querySelector('[data-a="toggle"]').onclick = (e) => toggle(r, e.currentTarget);
    el.querySelector('[data-a="edit"]').onclick = () => openSheet(r);
    return el;
  }

  function reemplazar(nuevo) {
    const i = rows.findIndex(r => r.id === nuevo.id);
    if (i >= 0) rows[i] = nuevo; else rows.unshift(nuevo);
    render();
  }

  async function toggle(r, btn) {
    btn.disabled = true;
    const nuevo = r.estado === "entregada" ? "pendiente" : "entregada";
    try {
      reemplazar(await rpc("c_editar", { rid: r.id, d: { estado: nuevo } }));
      toast(nuevo === "entregada" ? "Marcada como entregada" : "Marcada como pendiente");
    } catch (e) { btn.disabled = false; toast(msgError(e)); }
  }

  ["f-todos", "f-pend", "f-ok"].forEach(id => $(id).onclick = () => {
    filtro = $(id).dataset.f;
    ["f-todos", "f-pend", "f-ok"].forEach(o => $(o).setAttribute("aria-pressed", String(o === id)));
    render();
  });
  $("q").addEventListener("input", render);
  $("fact").addEventListener("change", render);

  /* ---------- Registro rápido ---------- */
  function actValida() { return activa && acts.some(a => a.nombre === activa) ? activa : ""; }

  function renderQuick() {
    const act = actValida();
    $("q-act").textContent = act || "Sin actividad elegida";
    $("q-change").hidden = !isAdmin;
    $("q-in").disabled = !act;
    $("q-hint").textContent = !act
      ? (isAdmin ? "Elige la actividad activa en la pestaña Administrar." : "El administrador debe elegir la actividad activa.")
      : !catalogo.length ? "El catálogo de alumnos está vacío. Usa “+ Registrar alumno” para escribirlo a mano."
      : "Toca el alumno para registrarlo. Para dictar, usa el micrófono de tu teclado.";

    const box = $("q-res");
    const found = act ? buscarCat($("q-in").value, 5) : [];
    if (!found.length) {
      box.innerHTML = norm($("q-in").value).length >= 2 && act
        ? '<p class="hint" style="margin:0">No se encontró. Prueba solo con el nombre o el primer apellido.</p>' : "";
    } else {
      box.replaceChildren(...found.map(a => {
        const b = document.createElement("button"); b.type = "button";
        const dup = yaRegistrado(a, act);
        const n = document.createElement("b"); n.textContent = a.n;
        const c = document.createElement("code"); c.textContent = (a.c || "") + (dup ? " · Ya registrado, " + folio(dup.folio) : "");
        b.append(n, c);
        b.disabled = !!dup;
        b.onclick = () => registrarRapido(a, b);
        return b;
      }));
    }
    if (ultimo) {
      $("q-last-txt").textContent = "✓ " + ultimo.nombre + " · " + folio(ultimo.folio);
      $("q-last").hidden = false;
    } else $("q-last").hidden = true;
  }

  async function registrarRapido(a, btn) {
    const act = actValida();
    if (!act || yaRegistrado(a, act)) return;
    if (btn) btn.disabled = true;
    try {
      const r = await rpc("c_registrar", { d: { control: a.c, nombre: a.n, carrera: a.ca || "", actividad: act, fecha: hoy(), estado: "pendiente" } });
      ultimo = r;
      $("q-in").value = "";
      reemplazar(r);
      $("q-in").focus();
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(msgError(e));
      if (e.code === "duplicado") refrescar();
    }
  }

  $("q-in").addEventListener("input", renderQuick);
  $("q-in").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const act = actValida();
    const libres = buscarCat($("q-in").value, 5).filter(a => !yaRegistrado(a, act));
    if (libres.length === 1) registrarRapido(libres[0], null);
  });
  $("q-undo").onclick = async () => {
    if (!ultimo) return;
    const u = ultimo; ultimo = null; renderQuick();
    try {
      await rpc("c_borrar", { rid: u.id });
      rows = rows.filter(r => r.id !== u.id); render();
      toast("Se quitó a " + u.nombre);
    } catch (e) { ultimo = u; renderQuick(); toast(msgError(e)); }
  };
  $("q-change").onclick = () => tab("adm");
  $("activa").addEventListener("change", async () => {
    const v = $("activa").value;
    try { await rpc("c_activa", { nombre_act: v }); activa = v; render(); toast(v ? "Actividad activa: " + v : "Sin actividad activa"); }
    catch (e) { toast(msgError(e)); }
  });

  /* ---------- Hoja de registro ---------- */
  function fillActs(actual) {
    const s = $("actividad");
    const nombres = acts.map(a => a.nombre);
    if (actual && !nombres.includes(actual)) nombres.unshift(actual);
    s.replaceChildren(...nombres.map(n => new Option(n, n)));
    if (actual) s.value = actual;
    else { const pref = actValida() || $("fact").value; if (pref && nombres.includes(pref)) s.value = pref; }
    $("noacts").hidden = nombres.length > 0;
    s.disabled = nombres.length === 0;
  }

  function setAlumno(a) {
    elegido = a; manual = false;
    $("pick").hidden = !!a; $("chosen").hidden = !a; $("manualfields").hidden = true;
    if (a) { $("ch-control").textContent = a.c ? "No. control " + a.c : "Sin número de control"; $("ch-nombre").textContent = a.n; }
    else { $("buscar").value = ""; $("matches").hidden = true; }
  }
  function setManual(c, n) {
    elegido = null; manual = true;
    $("pick").hidden = true; $("chosen").hidden = true; $("manualfields").hidden = false;
    $("control").value = c || ""; $("nombre").value = n || "";
  }

  $("buscar").addEventListener("input", () => {
    const box = $("matches");
    if (norm($("buscar").value).length < 2) { box.hidden = true; return; }
    const res = buscarCat($("buscar").value, 8);
    if (!res.length) {
      box.innerHTML = '<div class="hint" style="padding:10px 12px">' + (catalogo.length ? "No se encontró. Revisa el número o escríbelo a mano." : "El catálogo de alumnos aún está vacío. Escríbelo a mano.") + "</div>";
    } else {
      box.replaceChildren(...res.map(a => {
        const b = document.createElement("button"); b.type = "button";
        const c = document.createElement("code"); c.textContent = a.c;
        const n = document.createElement("span"); n.textContent = a.n;
        b.append(c, n); b.onclick = () => setAlumno(a); return b;
      }));
    }
    box.hidden = false;
  });
  $("change").onclick = () => { setAlumno(null); $("buscar").focus(); };
  $("manual").onclick = () => { setManual("", /^\d+$/.test($("buscar").value.trim()) ? "" : $("buscar").value.trim()); $("control").focus(); };

  function openSheet(r) {
    editId = r ? r.id : null; armDelete = false;
    $("sheet-title").textContent = r ? "Editar registro" : "Registrar alumno";
    if (r) {
      const enCat = catalogo.find(a => a.c && a.c === r.control);
      if (enCat) setAlumno(enCat); else setManual(r.control, r.nombre);
    } else setAlumno(null);
    fillActs(r ? r.actividad : "");
    $("fecha").value = r ? r.fecha || "" : hoy();
    $("notas").value = r ? r.notas || "" : "";
    $(r && r.estado === "entregada" ? "e-ok" : "e-pend").checked = true;
    $("del").hidden = !r; $("del").textContent = "Eliminar";
    $("ferr").hidden = true;
    $("sheet").hidden = false;
    if (!r) setTimeout(() => $("buscar").focus(), 50);
  }
  function closeSheet() { $("sheet").hidden = true; editId = null; }

  $("add").onclick = () => openSheet(null);
  $("cancel").onclick = closeSheet;
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = (m) => { $("ferr").textContent = m; $("ferr").hidden = false; };
    const control = elegido ? elegido.c : $("control").value.trim();
    const nombre = elegido ? elegido.n : $("nombre").value.trim();
    const actividad = $("actividad").value;
    if (!nombre) return err("Busca al alumno o escribe su nombre.");
    if (!actividad) return err("Elige la actividad en la que participó.");
    const dup = rows.find(r => r.id !== editId && r.actividad === actividad &&
      (control ? r.control === control : norm(r.nombre) === norm(nombre)));
    if (dup) return err("Este alumno ya está registrado en " + actividad + " (" + folio(dup.folio) + ").");

    const d = {
      control, nombre, actividad,
      carrera: elegido ? elegido.ca || "" : ((catalogo.find(a => control && a.c === control) || {}).ca || ""),
      fecha: $("fecha").value,
      notas: $("notas").value.trim(),
      estado: document.querySelector('input[name="estado"]:checked').value
    };
    $("save").disabled = true;
    try {
      if (editId) { reemplazar(await rpc("c_editar", { rid: editId, d })); toast("Cambios guardados"); }
      else { const r = await rpc("c_registrar", { d }); reemplazar(r); toast("Registrado · " + folio(r.folio)); }
      closeSheet();
    } catch (ex) { err(msgError(ex)); }
    finally { $("save").disabled = false; }
  });

  $("del").onclick = async () => {
    if (!armDelete) { armDelete = true; $("del").textContent = "Toca otra vez para eliminar"; return; }
    try {
      await rpc("c_borrar", { rid: editId });
      rows = rows.filter(r => r.id !== editId); render();
      toast("Registro eliminado"); closeSheet();
    } catch (ex) { $("ferr").textContent = msgError(ex); $("ferr").hidden = false; }
  };

  /* ---------- Administrador ---------- */
  function renderAdmin() {
    const ul = $("actlist");
    if (!acts.length) {
      ul.innerHTML = '<li><span class="hint">Todavía no hay actividades. Agrega la primera arriba.</span></li>';
    } else {
      ul.replaceChildren(...acts.map(a => {
        const li = document.createElement("li");
        const s = document.createElement("span"); s.textContent = a.nombre;
        const n = rows.filter(r => r.actividad === a.nombre).length;
        const sm = document.createElement("small"); sm.textContent = n + (n === 1 ? " alumno" : " alumnos");
        const b = document.createElement("button"); b.className = "btn danger";
        b.textContent = armAct === a.id ? "¿Seguro? Toca otra vez" : "Quitar";
        b.onclick = () => quitarAct(a);
        const right = document.createElement("div"); right.style.cssText = "display:flex;gap:10px;align-items:center";
        right.append(sm, b); li.append(s, right); return li;
      }));
    }
    const sa = $("activa");
    sa.replaceChildren(new Option("— Ninguna —", ""), ...acts.map(a => new Option(a.nombre, a.nombre)));
    sa.value = actValida();
    $("catcount").textContent = catalogo.length.toLocaleString("es-MX");
    $("catinfo").textContent = catalogo.length
      ? "Alumnos cargados con número de control y nombre. Al registrar, se buscan aquí."
      : "Aún no hay alumnos cargados.";
  }

  $("actform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = $("actname").value.trim().replace(/\s+/g, " ");
    if (!nombre) return;
    if (acts.some(a => norm(a.nombre) === norm(nombre))) { toast("Esa actividad ya existe"); return; }
    $("actadd").disabled = true;
    try { await rpc("c_act_agregar", { nombre_act: nombre }); $("actname").value = ""; toast("Actividad agregada"); await refrescar(); }
    catch (ex) { toast(msgError(ex)); }
    finally { $("actadd").disabled = false; }
  });

  async function quitarAct(a) {
    if (armAct !== a.id) { armAct = a.id; renderAdmin(); return; }
    armAct = null;
    try { await rpc("c_act_quitar", { aid: a.id }); toast("Actividad quitada. Sus registros se conservan."); await refrescar(); }
    catch (ex) { toast(msgError(ex)); renderAdmin(); }
  }

  /* ---------- Exportar ---------- */
  function hoja(filas, anchos) { const ws = XLSX.utils.aoa_to_sheet(filas); ws["!cols"] = anchos.map(w => ({ wch: w })); return ws; }
  function filaRegistro(r) {
    return [String(r.folio || "").padStart(4, "0"), r.control || "", r.nombre || "", carreraDe(r), r.actividad || "", r.fecha || "",
      r.estado === "entregada" ? "Entregada" : "Pendiente", r.entregadaEl || "", r.notas || ""];
  }
  const CAB_REG = ["Folio", "Número de control", "Nombre", "Carrera", "Actividad", "Fecha", "Estado", "Entregada el", "Notas"];
  const ANCHO_REG = [7, 16, 36, 10, 22, 12, 11, 13, 30];
  function sinXlsx() { if (window.XLSX) return false; toast("El generador de Excel aún está cargando. Intenta en unos segundos."); return true; }

  $("csv").onclick = () => {
    if (sinXlsx()) return;
    const fa = $("fact").value;
    const lista = rows.filter(r => !fa || r.actividad === fa).sort((a, b) => (a.folio || 0) - (b.folio || 0));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hoja([CAB_REG].concat(lista.map(filaRegistro)), ANCHO_REG), "Registros");
    XLSX.writeFile(wb, "constancias-" + (fa ? norm(fa).replace(/[^a-z0-9]+/g, "-") + "-" : "") + hoy() + ".xlsx");
  };

  $("xlsx").onclick = () => {
    if (sinXlsx()) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hoja([CAB_REG].concat(
      rows.slice().sort((a, b) => (a.folio || 0) - (b.folio || 0)).map(filaRegistro)), ANCHO_REG), "Registros");
    XLSX.utils.book_append_sheet(wb, hoja(
      [["Número de control", "Nombre", "Carrera"]].concat(catalogo.map(a => [a.c, a.n, a.ca])), [16, 40, 10]), "Catálogo de alumnos");
    XLSX.utils.book_append_sheet(wb, hoja(
      [["Actividad", "Alumnos registrados", "Pendientes", "Entregadas"]].concat(acts.map(a => {
        const rs = rows.filter(r => r.actividad === a.nombre), ok = rs.filter(r => r.estado === "entregada").length;
        return [a.nombre, rs.length, rs.length - ok, ok];
      })), [26, 20, 12, 12]), "Actividades");
    XLSX.writeFile(wb, "constancias-bases-" + hoy() + ".xlsx");
  };

  /* ---------- Inicio ---------- */
  (async function start() {
    if (!CFG.supabaseUrl || !CFG.supabaseKey) {
      $("lock").hidden = false;
      $("lerr").textContent = "Falta configurar la conexión con Supabase (config.js).";
      $("lerr").hidden = false; return;
    }
    const guardado = lsGet(LS_CODIGO);
    if (guardado && await entrar(guardado, true)) return;
    $("lock").hidden = false;
    $("lcode").focus();
  })();
})();
