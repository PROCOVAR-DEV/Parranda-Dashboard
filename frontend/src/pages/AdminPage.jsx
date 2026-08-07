import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { TERRITORIES, SKUS, currentMonthISO, defaultDateRange } from "../constants";
import useEstadoRefresh from "../hooks/useEstadoRefresh";
import ErrorBanner from "../components/shared/ErrorBanner";

const SECTIONS = [
  { id: "usuarios", label: "Usuarios" },
  { id: "metas", label: "Metas" },
  { id: "datos", label: "Datos" },
];

const TAB_OPTIONS = [
  { id: "ventas", label: "Ventas" },
  { id: "stock", label: "Stock" },
  { id: "clientes", label: "Clientes" },
  { id: "portafolio", label: "Portafolio" },
  { id: "pedidos", label: "Pedidos" },
  { id: "metareal", label: "Real vs Meta" },
];

export default function AdminPage() {
  const [section, setSection] = useState("usuarios");

  return (
    <div className="px-4 pb-6 pt-1 space-y-4">
      <div className="flex gap-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              section === s.id
                ? "bg-navy text-white border-navy"
                : "bg-white text-gray-600 border-gray-300 hover:border-navy"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "usuarios" && <UsersSection />}
      {section === "metas" && <MetasSection />}
      {section === "datos" && <DatosSection />}
    </div>
  );
}

// ── Usuarios ──────────────────────────────────────────────────────────────────

function UsersSection() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ username: "", password: "", display_name: "", role: "viewer" });
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [editing, setEditing] = useState(null); // user id being password-reset

  const load = useCallback(() => {
    api.get("/users").then((r) => setUsers(r.data)).catch((e) => setError(e.response?.data?.error || "Error"));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createUser(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/users", form);
      setForm({ username: "", password: "", display_name: "", role: "viewer" });
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Error al crear usuario");
    }
  }

  async function updateUser(id, payload) {
    setError(null);
    try {
      await api.put(`/users/${id}`, payload);
      load();
    } catch (err) {
      setError(err.response?.data?.error || "Error al actualizar usuario");
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* Create form */}
      <form onSubmit={createUser} className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-navy mb-3">Crear Usuario</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            placeholder="Usuario"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-navy"
          />
          <div className="relative">
            <input
              placeholder="Contraseña (mín. 6)"
              type={showCreatePwd ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="border border-gray-300 rounded pl-2 pr-14 py-1.5 text-sm w-full font-mono focus:outline-none focus:border-navy"
            />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-1">
              <button
                type="button"
                onClick={() => setShowCreatePwd((v) => !v)}
                title={showCreatePwd ? "Ocultar" : "Mostrar"}
                className="text-xs text-gray-400 hover:text-navy"
              >
                {showCreatePwd ? "🙈" : "👁"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, password: generatePassword() }));
                  setShowCreatePwd(true);
                }}
                title="Generar contraseña aleatoria"
                className="text-xs text-gray-400 hover:text-navy"
              >
                🎲
              </button>
            </span>
          </div>
          <input
            placeholder="Nombre"
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-navy"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-navy"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={!form.username || form.password.length < 6}
            className="bg-navy text-white rounded text-sm font-semibold hover:bg-navy-dark transition-colors disabled:opacity-40 py-1.5"
          >
            Crear
          </button>
        </div>
      </form>

      {/* User list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy text-white text-left">
              <th className="px-4 py-2.5 font-semibold">Usuario</th>
              <th className="px-4 py-2.5 font-semibold">Nombre</th>
              <th className="px-4 py-2.5 font-semibold">Rol</th>
              <th className="px-4 py-2.5 font-semibold">Pestañas Visibles</th>
              <th className="px-4 py-2.5 font-semibold">Territorios</th>
              <th className="px-4 py-2.5 font-semibold">Estado</th>
              <th className="px-4 py-2.5 font-semibold">Creado</th>
              <th className="px-4 py-2.5 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr key={u.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-4 py-2 font-medium text-gray-800">{u.username}</td>
                <td className="px-4 py-2 text-gray-600">{u.display_name || "—"}</td>
                <td className="px-4 py-2">
                  <select
                    value={u.role}
                    onChange={(e) => updateUser(u.id, { role: e.target.value })}
                    className="border border-gray-200 rounded px-1.5 py-0.5 text-xs"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  {u.role === "admin" ? (
                    <span className="text-[11px] text-gray-400 italic">Todas (admin)</span>
                  ) : (
                    <PermisoSelect
                      opciones={TAB_OPTIONS}
                      valor={u.allowed_tabs}
                      etiquetaTodos="Todas las pestañas"
                      onChange={(tabs) => updateUser(u.id, { allowed_tabs: tabs })}
                    />
                  )}
                </td>
                <td className="px-4 py-2">
                  {u.role === "admin" ? (
                    <span className="text-[11px] text-gray-400 italic">
                      Todos (admin)
                    </span>
                  ) : (
                    <PermisoSelect
                      opciones={TERRITORIES.map((t) => ({ id: t, label: t }))}
                      valor={u.allowed_territories}
                      etiquetaTodos="Todos los territorios"
                      onChange={(t) =>
                        updateUser(u.id, { allowed_territories: t })
                      }
                    />
                  )}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      u.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {u.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs whitespace-nowrap">
                  {u.created_at ? u.created_at.slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                  {editing === u.id ? (
                    <PasswordReset
                      onSave={(pwd) => {
                        updateUser(u.id, { password: pwd });
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <button onClick={() => setEditing(u.id)} className="text-xs text-navy hover:underline">
                        Cambiar contraseña
                      </button>
                      <button
                        onClick={() => updateUser(u.id, { active: !u.active })}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        {u.active ? "Desactivar" : "Activar"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



/**
 * Elegir varias opciones sin llenar la fila de fichas.
 *
 * Antes cada permiso se pintaba como una ficha por opcion. Con seis pestañas
 * cabian en una linea; con NUEVE territorios se partian en dos filas y cada
 * usuario ocupaba el triple de alto — la tabla se leia peor cuantas mas
 * sucursales hubiera, que es justo al reves de lo que hace falta.
 *
 * El boton dice el estado en palabras, no en numeros sueltos: "Todos",
 * "Camagüey", o "Camagüey +2". Quien administra quiere saber de un vistazo si
 * alguien esta restringido y a que; el detalle exacto lo abre solo si le hace
 * falta.
 *
 * `null` significa TODOS, igual que en la base: no hay dos formas de decir lo
 * mismo. Y no se puede dejar a nadie con cero — un usuario sin nada entra a un
 * panel vacio, que parece roto y no lo esta. Para quitarle el acceso esta
 * "Desactivar", que es lo que de verdad significa.
 */
function PermisoSelect({ opciones, valor, onChange, etiquetaTodos }) {
  const [abierto, setAbierto] = useState(false);
  const [caja, setCaja] = useState(null);
  const boton = useRef(null);
  const panel = useRef(null);

  const activos = valor ?? opciones.map((o) => o.id);
  const todos = activos.length === opciones.length;

  // La lista se dibuja FUERA de la tabla, con un portal.
  //
  // Dentro de la celda no vale ni siendo `absolute`: la tabla tiene su propio
  // desplazamiento, asi que al abrirse le crecia el alto, aparecia una barra
  // lateral y las filas de abajo se movian. Un desplegable no puede empujar la
  // pagina que hay debajo.
  //
  // Al ir por portal se posiciona con las coordenadas del boton (`fixed`), y
  // ningun contenedor de arriba puede recortarlo ni estirarse por su culpa.
  const colocar = useCallback(() => {
    const r = boton.current?.getBoundingClientRect();

    if (!r) return;

    const ALTO = 260;
    // Si no cabe debajo, se abre hacia arriba. Si no, en las ultimas filas la
    // lista se sale por el borde inferior y hay que hacer scroll para verla.
    const haciaArriba = r.bottom + ALTO > window.innerHeight && r.top > ALTO;

    setCaja({
      left: r.left,
      top: haciaArriba ? undefined : r.bottom + 4,
      bottom: haciaArriba ? window.innerHeight - r.top + 4 : undefined,
      minWidth: Math.max(r.width, 200),
    });
  }, []);

  useEffect(() => {
    if (!abierto) return;

    colocar();

    const fuera = (e) => {
      // El panel vive fuera de este componente, asi que hay que mirar los DOS:
      // si solo se mirara el boton, elegir una opcion contaria como "clic
      // fuera" y se cerraria en cuanto se marcara la primera.
      if (boton.current?.contains(e.target)) return;
      if (panel.current?.contains(e.target)) return;
      setAbierto(false);
    };
    const escape = (e) => e.key === "Escape" && setAbierto(false);

    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    // Al desplazar la pagina el boton se mueve y la lista se quedaria flotando
    // en el sitio equivocado: se recoloca.
    window.addEventListener("scroll", colocar, true);
    window.addEventListener("resize", colocar);

    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", colocar, true);
      window.removeEventListener("resize", colocar);
    };
  }, [abierto, colocar]);

  function alternar(id) {
    const siguiente = activos.includes(id)
      ? activos.filter((x) => x !== id)
      : [...activos, id];

    if (siguiente.length === 0) return;
    onChange(siguiente.length === opciones.length ? null : siguiente);
  }

  const nombres = opciones.filter((o) => activos.includes(o.id)).map((o) => o.label);
  const resumen = todos
    ? etiquetaTodos
    : nombres.length === 1
      ? nombres[0]
      : `${nombres[0]} +${nombres.length - 1}`;

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className={`flex items-center gap-1.5 min-w-[170px] px-2.5 py-1 rounded-md border text-xs text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy/40 ${
          todos
            ? "border-gray-200 text-gray-400 bg-white hover:border-gray-300"
            : "border-navy/30 text-navy bg-navy/5 hover:border-navy/50 font-semibold"
        }`}
      >
        <span className="flex-1 truncate">{resumen}</span>
        <span className="text-[9px] opacity-60">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto &&
        caja &&
        createPortal(
          <div
            ref={panel}
            style={{
              position: "fixed",
              left: caja.left,
              top: caja.top,
              bottom: caja.bottom,
              minWidth: caja.minWidth,
            }}
            className="z-50 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white shadow-xl py-1"
          >
            <button
              type="button"
              onClick={() => onChange(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-navy hover:bg-gray-50 border-b border-gray-100"
            >
              {etiquetaTodos}
            </button>
            {opciones.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50 whitespace-nowrap"
              >
                <input
                  type="checkbox"
                  checked={activos.includes(o.id)}
                  onChange={() => alternar(o.id)}
                  className="accent-[#1B3A6B] w-3.5 h-3.5"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function PasswordReset({ onSave, onCancel }) {
  const [pwd, setPwd] = useState("");
  const [visible, setVisible] = useState(true);
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type={visible ? "text" : "password"}
        placeholder="Nueva contraseña"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        className="border border-gray-300 rounded px-2 py-0.5 text-xs w-36 font-mono"
        autoFocus
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Ocultar" : "Mostrar"}
        className="text-xs text-gray-400 hover:text-navy"
      >
        {visible ? "🙈" : "👁"}
      </button>
      <button
        type="button"
        onClick={() => setPwd(generatePassword())}
        title="Generar contraseña aleatoria"
        className="text-xs text-gray-400 hover:text-navy"
      >
        🎲
      </button>
      <button
        onClick={() => pwd.length >= 6 && onSave(pwd)}
        disabled={pwd.length < 6}
        className="text-xs text-emerald-600 font-semibold disabled:opacity-40"
      >
        Guardar
      </button>
      <button onClick={onCancel} className="text-xs text-gray-400">
        Cancelar
      </button>
    </span>
  );
}

// ── Metas ─────────────────────────────────────────────────────────────────────

function MetasSection() {
  const [mes, setMes] = useState(currentMonthISO());
  const [grid, setGrid] = useState({}); // `${territorio}|${sku}` → string value
  const [diasTotales, setDiasTotales] = useState("");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback((m) => {
    setStatus(null);
    api
      .get("/metas", { params: { mes: m } })
      .then((r) => {
        const g = {};
        r.data.items.forEach((it) => {
          g[`${it.territorio}|${it.sku_codigo}`] = String(it.hl);
        });
        setGrid(g);
        setDiasTotales(r.data.dias_totales_override ?? "");
      })
      .catch((e) => setError(e.response?.data?.error || "Error al cargar metas"));
  }, []);

  useEffect(() => { load(mes); }, [mes, load]);

  async function save() {
    setError(null);
    setStatus(null);
    const items = [];
    Object.entries(grid).forEach(([key, value]) => {
      const [territorio, sku_codigo] = key.split("|");
      const hl = parseFloat(value);
      if (!Number.isNaN(hl)) items.push({ territorio, sku_codigo, hl });
    });
    try {
      await api.post("/metas", { mes, items, dias_totales: diasTotales || null });
      setStatus("Metas guardadas correctamente.");
    } catch (err) {
      setError(err.response?.data?.error || "Error al guardar metas");
    }
  }

  async function copyFromPrevious() {
    setError(null);
    setStatus(null);
    const [y, m] = mes.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    try {
      await api.post("/metas/copy", { from_mes: prev, to_mes: mes });
      setStatus(`Metas copiadas desde ${prev}.`);
      load(mes);
    } catch (err) {
      setError(err.response?.data?.error || "Error al copiar metas");
    }
  }

  const totals = {};
  TERRITORIES.forEach((t) => {
    totals[t] = SKUS.reduce((s, sku) => s + (parseFloat(grid[`${t}|${sku.codigo}`]) || 0), 0);
  });

  return (
    <div className="space-y-4">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {status && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded px-4 py-2.5">
          {status}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Mes</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Días laborales (vacío = auto Lun–Vie)
          </label>
          <input
            type="number"
            min="1"
            max="31"
            value={diasTotales}
            onChange={(e) => setDiasTotales(e.target.value)}
            placeholder="auto"
            className="border border-gray-300 rounded px-2 py-1 text-sm w-20 focus:outline-none focus:border-navy"
          />
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={copyFromPrevious}
            className="px-3 py-1.5 rounded border border-gray-300 text-xs text-gray-600 hover:border-navy hover:text-navy transition-colors"
          >
            Copiar mes anterior
          </button>
          <button
            onClick={save}
            className="px-4 py-1.5 rounded bg-navy text-white text-xs font-semibold hover:bg-navy-dark transition-colors"
          >
            Guardar Metas
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-navy text-white">
              <th className="text-left px-4 py-2.5 font-semibold min-w-[160px]">Territorio</th>
              {SKUS.map((s) => (
                <th key={s.codigo} className="text-right px-3 py-2.5 font-semibold text-xs">
                  {s.codigo} (HL)
                </th>
              ))}
              <th className="text-right px-3 py-2.5 font-semibold bg-navy-dark">TOTAL HL</th>
            </tr>
          </thead>
          <tbody>
            {TERRITORIES.map((t, idx) => (
              <tr key={t} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-4 py-1.5 text-gray-800 font-medium">{t}</td>
                {SKUS.map((s) => (
                  <td key={s.codigo} className="px-2 py-1.5 text-right">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={grid[`${t}|${s.codigo}`] ?? ""}
                      onChange={(e) => setGrid({ ...grid, [`${t}|${s.codigo}`]: e.target.value })}
                      className="border border-gray-200 rounded px-2 py-1 text-sm w-24 text-right focus:outline-none focus:border-navy"
                    />
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-gray-800 bg-amber-50">
                  {totals[t].toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
            <tr className="bg-[#FFF2CC] font-semibold">
              <td className="px-4 py-2 text-gray-800">TOTAL</td>
              {SKUS.map((s) => (
                <td key={s.codigo} className="px-3 py-2 text-right tabular-nums text-gray-800">
                  {TERRITORIES.reduce((sum, t) => sum + (parseFloat(grid[`${t}|${s.codigo}`]) || 0), 0)
                    .toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums text-gray-800 bg-[#FFE57A]">
                {Object.values(totals)
                  .reduce((a, b) => a + b, 0)
                  .toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Datos (ETL refresh + server config) ───────────────────────────────────────

function DatosSection() {
  const [range, setRange] = useState(defaultDateRange());
  const [error, setError] = useState(null);
  const [host, setHost] = useState("");
  const [pedidosUrl, setPedidosUrl] = useState("");
  const [pedidosKey, setPedidosKey] = useState("");
  const [pedidosKeySet, setPedidosKeySet] = useState(false);

  // Mismo canal de eventos que el boton de la cabecera: el servidor avisa, aqui
  // no se pregunta nada. Antes esta pantalla tenia su PROPIO temporizador, asi
  // que teniendola abierta junto al panel se preguntaba dos veces por lo mismo.
  const { status } = useEstadoRefresh();

  useEffect(() => {
    api
      .get("/config/server")
      .then((r) => {
        setHost(r.data.axispos_host);
        setPedidosUrl(r.data.pedidos_api_url || "");
        setPedidosKeySet(Boolean(r.data.pedidos_api_key_set));
      })
      .catch(() => {});
  }, []);

  async function triggerRefresh(territories = null) {
    setError(null);
    try {
      const body = { fecha_inicio: range.fecha_inicio, fecha_fin: range.fecha_fin };
      if (territories) {
        await api.post("/refresh/retry", { ...body, territories });
      } else {
        await api.post("/refresh", body);
      }
      // Nada que hacer: el canal de eventos avisa en cuanto arranca.
    } catch (err) {
      setError(err.response?.data?.error || "Error al iniciar actualización");
    }
  }

  async function saveHost() {
    setError(null);
    try {
      await api.post("/config/server", { axispos_host: host });
    } catch (err) {
      setError(err.response?.data?.error || "Error al guardar configuración");
    }
  }

  async function savePedidos() {
    setError(null);
    try {
      // An empty key means "keep the stored one" — the server never sends it back.
      const r = await api.post("/config/server", {
        pedidos_api_url: pedidosUrl,
        pedidos_api_key: pedidosKey,
      });
      setPedidosKey("");
      setPedidosKeySet(Boolean(r.data.pedidos_api_key_set));
    } catch (err) {
      setError(err.response?.data?.error || "Error al guardar configuración");
    }
  }

  const running = status?.status === "running";

  return (
    <div className="space-y-4 max-w-2xl">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-navy">Actualizar Datos desde AxisPos</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Desde</label>
            <input
              type="date"
              value={range.fecha_inicio}
              onChange={(e) => setRange({ ...range, fecha_inicio: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Hasta</label>
            <input
              type="date"
              value={range.fecha_fin}
              onChange={(e) => setRange({ ...range, fecha_fin: e.target.value })}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
            />
          </div>
          <button
            onClick={() => triggerRefresh()}
            disabled={running}
            className="px-4 py-1.5 rounded bg-navy text-white text-sm font-semibold hover:bg-navy-dark transition-colors disabled:opacity-50"
          >
            {running ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {status && status.status !== "idle" && (
          <div
            className={`text-sm rounded px-4 py-2.5 border ${
              status.status === "running"
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : status.status === "ok"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-amber-50 border-amber-200 text-amber-800"
            }`}
          >
            {status.status === "running" && "Actualización en curso…"}
            {status.status === "ok" &&
              `Última actualización completada — ${status.rows_upserted} filas (${status.finished_at?.slice(0, 16).replace("T", " ")})`}
            {(status.status === "partial" || status.status === "error") && (
              <span>
                Fallaron: {status.failed_territories.join(", ")}{" "}
                <button
                  onClick={() => triggerRefresh(status.failed_territories)}
                  className="underline font-semibold ml-2"
                >
                  Reintentar
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-navy">Servidor AxisPos</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Host MySQL</label>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
            />
          </div>
          <button
            onClick={saveHost}
            className="px-4 py-1.5 rounded border border-gray-300 text-sm text-gray-600 hover:border-navy hover:text-navy transition-colors"
          >
            Guardar
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          Cambiar solo cuando el servidor AxisPos se mueva de dirección (p. ej. migración a VPS).
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-navy">Sistema de Pedidos</h3>
        <div>
          <label className="text-xs text-gray-500 block mb-1">URL de la API</label>
          <input
            value={pedidosUrl}
            onChange={(e) => setPedidosUrl(e.target.value)}
            placeholder="https://pedidos.procovar.cloud/api"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-navy"
          />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">
              API Key {pedidosKeySet && <span className="text-emerald-600">· configurada</span>}
            </label>
            <input
              type="password"
              value={pedidosKey}
              onChange={(e) => setPedidosKey(e.target.value)}
              placeholder={pedidosKeySet ? "•••••••• (sin cambios)" : "pk_…"}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:border-navy"
            />
          </div>
          <button
            onClick={savePedidos}
            className="px-4 py-1.5 rounded border border-gray-300 text-sm text-gray-600 hover:border-navy hover:text-navy transition-colors"
          >
            Guardar
          </button>
        </div>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          La key debe emitirse desde una cuenta <b>Super Admin</b> del Sistema de Pedidos
          (Panel → Configuración → API Keys). Una key emitida por un usuario sin sucursal no puede
          consultar todas las sucursales y la pestaña Pedidos quedará vacía.
        </p>
      </div>
    </div>
  );
}
