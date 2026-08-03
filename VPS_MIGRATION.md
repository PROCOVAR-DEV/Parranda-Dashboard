# Guía de Migración a VPS — Dashboard Procovar Parranda

Plan paso a paso para mover este dashboard de la máquina Windows de desarrollo a
un VPS. Escrito el 2026-08-03. Asume Ubuntu 22.04/24.04 en el VPS; adapta los
nombres de paquetes para otras distribuciones. Lee la Fase 0 completa antes de
cambiar nada.

Cada fase termina en un **PUNTO DE CONTROL** — una comprobación que debe pasar
antes de continuar. No te saltes ninguno: dos de los fallos posibles en esta
migración (zona horaria y alcance a AxisPos) producen *números silenciosamente
incorrectos* en lugar de errores visibles.

Marcadores a sustituir a lo largo del documento:
`<VPS_IP>` · `<DOMAIN>` · `<PG_PASS>` (nueva contraseña fuerte de Postgres) · `<LAN_MYSQL_IP>`

---

## 0 — Vía alternativa: Docker + Dokploy

Desde 2026-08-03 existe un segundo camino de despliegue que sustituye a la Fase 2
completa y a partes de las Fases 5 y 6: el proyecto trae contenedores Docker y un
`docker-compose.yml`, y Dokploy orquesta Postgres + backend + frontend (nginx).

- **`backend/Dockerfile`** + `backend/entrypoint.sh` — instala `requirements.txt`
  y arranca `gunicorn -w 1 --threads 8 --bind 0.0.0.0:5051 "app:create_app()"`.
  El entrypoint llama `app.seed_database()` (como la Fase 5.4 lo requería a mano)
  antes de ejecutar gunicorn, porque bajo WSGI ese bloque de `__main__` nunca corre.
- **`frontend/Dockerfile`** (multi-stage node→nginx) + `frontend/nginx.conf` —
  sirve `dist/` con el fallback SPA y reenvía `/api` a `backend:5051`.
- **`docker-compose.yml`** — servicios `db` (postgres:16-alpine, volumen
  `pgdata`, healthcheck), `backend` (depende de `db` sano), `frontend` (puerto
  80). Las variables de entorno definen los secretos; usa `pg_restore` sobre el
  contenedor de `db` con el respaldo de la Fase 1.3 en lugar de Postgres nativo.

### Diferencias clave frente al flujo manual

1. **Secrets por variables de entorno, no por `config.json`.**
   `config.py:58` (`axispos_settings()`) ahora lee `AXISPOS_HOST/PORT/USER/
   PASSWORD` de env vars; `PEDIDOS_API_URL/PEDIDOS_API_KEY` ya se leían así.
   `config.json` y `.jwt_secret` quedan fuera de las imágenes (vía `.dockerignore`)
   — defínelos como env vars en Dokploy. `CORS_ORIGINS` (Fase 6.4 se vuelve)
   restringe CORS; si no se define, la API solo responde same-origin.
2. **El bloqueante de la Fase 0.1 (acceso a AxisPos) se mantiene intacto.** El
   VPS debe alcanzar el MySQL de AxisPos por túnel (WireGuard). `AXISPOS_HOST`
   debe apuntar a la dirección que el VPS sí puede alcanzar.
3. **La unidad de systemd (5.6) se reemplaza** por el contenedor; gunicorn ya usa
   `-w 1 --threads 8` por el lock de `routes/refresh.py` (§3.6 del CLAUDE.md).
4. **TLS y dominios los gestiona Dokploy/Traefik** — no hace falta certbot ni
   nginx en el host; asigna `ccsa.procovar.cloud` → puerto 80 de `frontend`.
5. **TZ=America/Havana** se inyecta como env var en `db`, `backend` y `frontend`
   (crítico por los `date.today()` de las rutas; ver Fase 2.2).

### Variables de entorno del compose

| Variable | Obligatoria | Notas |
|---|---|---|
| `PG_PASSWORD` | sí | contraseña fuerte de Postgres |
| `JWT_SECRET_KEY` | sí | si cambia, todos revuelven a loguear |
| `PEDIDOS_API_KEY` | sí | clave de pedidos (Super Admin) |
| `AXISPOS_HOST` | no | host del túnel hacia AxisPos MySQL |
| `PEDIDOS_API_URL` | no | default `https://pedidos.procovar.cloud/api` |
| `CORS_ORIGINS` | no | default `https://ccsa.procovar.cloud` |

Las Fases 4 (Postgres) y el punto 6.4 (CORS) cambian de forma: la base vive en
un volumen Docker y la restricción CORS se inyecta por env var. El resto de la
guía (1 tipado, 3 túnel, 7 verificación) aplica igual.

---

## Fase 0 — Decisiones antes de tocar nada

### 0.1 Elegir la vía de red hacia AxisPos — este es el bloqueante

`config.json` apunta a `10.188.2.2`, una dirección de red local que el VPS 
puede alcanzar. Esto no afecta solo al ETL: **el stock nunca se almacena en
PostgreSQL** (regla de negocio §3.6). `routes/stock.py:19` llama a
`extract_stock_territory` en vivo contra MySQL cada vez que se abre la pestaña
Stock, con los 9 territorios en paralelo.

| Opción | Ventas/Devoluciones/Clientes/Pedidos | Pestaña Stock |
|---|---|---|
| **A. Túnel VPN VPS → red local** (WireGuard) | funciona | funciona |
| **B. ETL corre dentro de la red local y empuja al Postgres del VPS** | funciona | **muerta — no hay nada que leer** |

**Recomendación: Opción A.** La opción B deja la pestaña Stock rota de forma
permanente, a menos que además guardes el stock en Postgres, lo cual es un cambio
de esquema que contradice la regla §3.6. No descubras esto después del cambio.

El resto de esta guía asume la Opción A.

### 0.2 Inventario de lo que debe migrar

- Base de datos PostgreSQL `parranda` (respaldo — ver 1.3)
- `backend/config.json` (host y credenciales de AxisPos + API key de pedidos)
- `backend/.jwt_secret` (consérvalo, o acepta que todos los usuarios tengan que
  volver a iniciar sesión una vez)
- Código fuente del proyecto — **nunca copies `backend/venv/`**, son binarios de
  Windows

### 0.3 Planificar una ventana de bajo tráfico

Haz el cambio cuando nadie necesite el dashboard. Calcula unas 2–3 horas para un
primer intento, incluyendo la fase de verificación.

---

## Fase 1 — Preparación en la máquina Windows

### 1.1 Limpiar primero los artefactos de pedidos de julio

La migración es el momento natural para corregir los residuos de §3.16, *antes*
de hacer el respaldo, para llevarte datos limpios en lugar de replicar el
problema:

- ~256 folios que existen solo en el host viejo `pedidos.marketplacecuba.com`
- 4 folios del 31 de julio cuyo `pedido_ext_id` cambió durante la migración de
  host y que por tanto existen duplicados

Identifícalos y bórralos por el `pedido_ext_id` obsoleto. **No** "arregles" esto
haciendo que el refresh borre — el refresh es solo de upserts por diseño (§3.8).

Verifica que los totales de pedidos de julio se vean correctos en la interfaz, y
continúa.

### 1.2 Corregir `requirements.txt` antes de desplegarlo

Al archivo le faltan actualmente dos paquetes que el código importa. Instalarlo
tal cual en el VPS produce un backend cuyo **refresh de Pedidos falla al
importar**.

Añade:

```
requests>=2.32        # etl/pedidos_extract.py:22 — en cada refresh
openpyxl>=3.1         # load_metas_excel.py:20 — script cargador de metas
gunicorn>=23.0        # servidor WSGI de producción (Fase 5)
```

`python-dateutil` está listado pero no se importa en ninguna parte del código —
es inofensivo, déjalo.

### 1.3 Respaldo de PostgreSQL

Restaura los datos; **no** planifiques volver a correr el ETL desde cero en el
VPS. Como `ventas_cliente` hace upsert con `DO NOTHING` (§3.8), el estado actual
depende del orden en que se aplicaron las correcciones pasadas — un ETL nuevo no
lo reproducirá.

```bash
pg_dump -U postgres -h localhost -Fc -d parranda -f parranda_YYYYMMDD.dump
```

Anota los conteos de filas para poder verificar la restauración en 4.3:

```sql
SELECT 'ventas', count(*) FROM ventas
UNION ALL SELECT 'devoluciones', count(*) FROM devoluciones
UNION ALL SELECT 'ventas_cliente', count(*) FROM ventas_cliente
UNION ALL SELECT 'pedidos', count(*) FROM pedidos
UNION ALL SELECT 'pedido_items', count(*) FROM pedido_items
UNION ALL SELECT 'facturas_observacion', count(*) FROM facturas_observacion
UNION ALL SELECT 'metas', count(*) FROM metas
UNION ALL SELECT 'users', count(*) FROM users;
```

### 1.4 Capturar cifras de referencia

Antes del cambio, anota los números principales del mes en curso (HL total y HL
por territorio) desde el dashboard en funcionamiento. Los contrastarás en 7.6.

**PUNTO DE CONTROL 1:** el archivo de respaldo existe y tiene un tamaño
razonable; los conteos de filas están anotados; `requirements.txt` actualizado.

---

## Fase 2 — Aprovisionar el VPS

### 2.1 Configuración base

```bash
adduser parranda && usermod -aG sudo parranda   # no ejecutes la app como root
apt update && apt upgrade -y
```

### 2.2 Configurar la zona horaria — crítico, no lo omitas

El backend llama a `date.today()` en 11 lugares de las rutas, leyendo el reloj
**del servidor**. Un VPS por defecto corre en UTC; Cuba está en UTC−4 (CDT) /
UTC−5 (CST). A partir de las ~20:00 de La Habana, un servidor en UTC ya está en
la fecha del día siguiente, lo que corrompe:

- `routes/meta.py:55` — "Último Crecimiento" (ayer) muestra el día equivocado
- `routes/meta.py:25,234` — días transcurridos con un día de desfase
- `routes/stock.py:71` — la fecha de stock por defecto es un día que aún no ocurrió
- `routes/ventas.py` — los rangos de fecha por defecto

```bash
timedatectl set-timezone America/Havana
timedatectl                                  # verificar
```

Configura además `TZ=America/Havana` explícitamente en la unidad de systemd (5.6)
para que el servicio siga siendo correcto aunque más adelante se cambie la zona
horaria del host.

El frontend no se ve afectado — sus funciones de fecha en `constants.js` usan el
reloj del navegador, que ya está en hora local de Cuba.

### 2.3 Paquetes

```bash
apt install -y python3 python3-venv python3-dev build-essential \
               postgresql nginx wireguard certbot python3-certbot-nginx git
```

Nada en el código requiere Python 3.14 (la versión del venv local) — el 3.12 de
la distribución sirve perfectamente.

### 2.4 Cortafuegos

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

**No** abras el 5051 (backend) ni el 5432 (Postgres) a internet. Ambos quedan
escuchando solo en localhost y se alcanzan únicamente a través de nginx o
localmente.

**PUNTO DE CONTROL 2:** `timedatectl` muestra `America/Havana`; `ufw status`
muestra solo SSH + Nginx.

---

## Fase 3 — Vía de red hacia AxisPos

### 3.1 Establecer el túnel

Configura WireGuard entre el VPS y la red local donde está el MySQL de AxisPos.
El lado de la red local necesita un peer que enrute hacia `<LAN_MYSQL_IP>`
(actualmente `192.168.1.3`).

### 3.2 Verificar el alcance desde el VPS — PUNTO DE CONTROL

```bash
nc -zv <LAN_MYSQL_IP> 3306          # debe conectar
```

Después demuestra que una consulta real funciona, usando el mismo driver de la
aplicación:

```bash
python3 -c "
import pymysql
c = pymysql.connect(host='<LAN_MYSQL_IP>', user='root', password='root',
                    connect_timeout=10)
cur = c.cursor(); cur.execute('SHOW DATABASES'); print(cur.fetchall())"
```

Deberías ver las bases de datos de los territorios (`habana`, `sspiritus`,
`camaguey`, `tunas`, `holguinmoa`, `moa`, `santiago`, `palmasoriano`,
`guantanamo`).

### 3.3 Medir la latencia y ajustar los timeouts

Los timeouts actuales están ajustados para una red local:

- `etl/extract.py:156` — `connect_timeout=10`
- `routes/stock.py` — `TERRITORY_TIMEOUT`, el timeout por territorio

Cronometra una consulta parecida a la de stock a través del túnel. Si se acerca a
estos límites, súbelos **antes** del cambio — de lo contrario la pestaña Stock
mostrará territorios en `territorios_fallidos` de forma intermitente y los
usuarios pensarán que faltan datos.

**PUNTO DE CONTROL 3:** una consulta MySQL real desde el VPS devuelve las 9 bases
de datos de territorios, y conoces tu latencia de ida y vuelta.

---

## Fase 4 — PostgreSQL en el VPS

### 4.1 Crear rol y base de datos con una contraseña real

```bash
sudo -u postgres psql
```
```sql
CREATE ROLE parranda LOGIN PASSWORD '<PG_PASS>';
CREATE DATABASE parranda OWNER parranda;
```

Retira `postgres/0612` — no viaja a un servidor público. Confirma que
`listen_addresses = 'localhost'` en `postgresql.conf`.

### 4.2 Restaurar

```bash
pg_restore -U parranda -h localhost -d parranda --no-owner parranda_YYYYMMDD.dump
```

### 4.3 Verificar — PUNTO DE CONTROL

Vuelve a ejecutar la consulta de conteos de 1.3 y compárala con los números
anotados. Deben coincidir exactamente.

---

## Fase 5 — Backend

### 5.1 Copiar el código

Copia el proyecto **excluyendo `backend/venv/` y `frontend/node_modules/`** a,
por ejemplo, `/opt/parranda`. Asigna la propiedad al usuario `parranda`.

### 5.2 Reconstruir el entorno virtual en Linux

```bash
cd /opt/parranda/backend
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt      # ya incluye requests/openpyxl/gunicorn
```

Verifica que las dos dependencias que faltaban se resuelvan realmente:

```bash
./venv/bin/python -c "import requests, openpyxl; print('deps ok')"
```

### 5.3 Configuración y secretos

- Define `DATABASE_URL=postgresql://parranda:<PG_PASS>@localhost:5432/parranda`
  (como variable de entorno en la unidad de systemd — no edites el valor por
  defecto en `config.py`).
- Copia `config.json`, actualizando `axispos_host` si el túnel presenta una
  dirección distinta de `192.168.1.3`.
- Copia `.jwt_secret` para mantener válidas las sesiones existentes, u omítelo
  para que se genere uno nuevo en el primer arranque (todos los usuarios tendrán
  que volver a iniciar sesión).

Restringe los permisos de ambos — contienen las credenciales de AxisPos y la API
key de pedidos:

```bash
chmod 600 backend/config.json backend/.jwt_secret
```

Ninguno de los dos puede quedar dentro del directorio que sirve nginx.

### 5.4 Sembrar la base de datos — el fallo silencioso del primer día

`seed_database()` vive dentro de `if __name__ == "__main__"` (`app.py:118-121`).
Gunicorn importa `create_app()` directamente, así que **nunca se ejecuta bajo un
servidor WSGI**. En una base restaurada desde un respaldo las tablas ya existen,
pero ejecútalo igualmente — es idempotente (protegido por `count() == 0`) y es lo
único que crea las tablas si alguna vez arrancas desde una base vacía:

```bash
cd /opt/parranda/backend
DATABASE_URL="postgresql://parranda:<PG_PASS>@localhost:5432/parranda" \
  ./venv/bin/python -c "import app; app.seed_database()"
```

Si imprime una contraseña de admin nueva, tu restauración no trajo la tabla de
usuarios — detente y corrige la Fase 4 antes de seguir.

### 5.5 Probar gunicorn a mano antes de escribir el servicio

```bash
DATABASE_URL="..." ./venv/bin/gunicorn -w 1 --threads 8 \
  -b 127.0.0.1:5051 "app:create_app()"
```
```bash
curl -s localhost:5051/api/health     # esperado: {"status":"ok", ...}
```

### 5.6 Unidad de systemd

> **Alternativa Docker/Dokploy:** este servicio equivale al contenedor `backend`
> del `docker-compose.yml` (vía §0). El entrypoint del contenedor ya llama
> `seed_database()` y lanza gunicorn; no escribas la unidad si usas Docker. Lo
> que sigue documenta el flujo manual para quien no use Dokploy.

Usa **`-w 1 --threads 8`**. Razón: `routes/refresh.py:33` usa un
`threading.Lock()` dentro del proceso para impedir ETL concurrentes. Con varios
*procesos* worker ese lock no significa nada y pueden correr dos refreshes a la
vez. Un solo proceso con hilos preserva exactamente la semántica de concurrencia
actual, y la carga de trabajo (esperas de MySQL/HTTP) es de E/S, así que los
hilos son la forma correcta.

`/etc/systemd/system/parranda.service`:

```ini
[Unit]
Description=Parranda Dashboard API
After=network.target postgresql.service

[Service]
User=parranda
WorkingDirectory=/opt/parranda/backend
Environment="TZ=America/Havana"
Environment="DATABASE_URL=postgresql://parranda:<PG_PASS>@localhost:5432/parranda"
ExecStart=/opt/parranda/backend/venv/bin/gunicorn -w 1 --threads 8 \
          --timeout 120 -b 127.0.0.1:5051 "app:create_app()"
Restart=always

[Install]
WantedBy=multi-user.target
```

**No** añadas `--max-requests`. El ETL corre en un hilo en segundo plano
(`refresh.py:129`); un worker reciclado lo mata a mitad de ejecución y deja el
`RefreshLog` atascado en `"running"` para siempre.

```bash
systemctl daemon-reload && systemctl enable --now parranda
systemctl status parranda
```

Esto además termina de forma permanente con el problema de procesos zombis de
Windows (varios servidores de desarrollo de Flask ocupando el puerto 5051 vía
`SO_REUSEADDR`) — systemd es dueño de exactamente un proceso.

**PUNTO DE CONTROL 5:** `curl localhost:5051/api/health` responde ok, y
`systemctl status parranda` está activo.

---

## Fase 6 — Frontend, nginx y TLS

### 6.1 Compilar

```bash
cd /opt/parranda/frontend
npm ci
npm run build          # genera dist/
```

**No hace falta ningún cambio de código.** `API_BASE` es el valor relativo
`"/api"` (`constants.js:175`), así que el frontend llama al mismo origen que lo
sirve. El proxy de `vite.config.js` es solo para desarrollo y es irrelevante en
producción.

### 6.2 nginx

```nginx
server {
    server_name <DOMAIN>;
    root /opt/parranda/frontend/dist;

    location / {
        try_files $uri $uri/ /index.html;   # respaldo SPA — sin esto, los enlaces profundos dan 404
    }

    location /api {
        proxy_pass http://127.0.0.1:5051;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;            # refresh y stock son lentos a través del túnel
    }
}
```

### 6.3 TLS — obligatorio

```bash
certbot --nginx -d <DOMAIN>
```

El JWT vive en `localStorage` y se envía en cada petición. Sobre HTTP plano se
roba trivialmente. No pospongas esto.

### 6.4 Restringir CORS

El backend ya no se abre del todo: `app.py:96` restringe CORS a la lista
`CORS_ORIGINS` (env var, separada por comas) sobre las rutas `/api/*`. Si
`CORS_ORIGINS` no está definida, la API solo responde same-origin — correcto en
producción, donde nginx sirve frontend y API en el mismo dominio. En flujo
manual (sin Docker), define `CORS_ORIGINS=https://<DOMAIN>` en la unidad de
systemd; en Docker/Dokploy, en el compose (default `https://ccsa.procovar.cloud`).

**PUNTO DE CONTROL 6:** `https://<DOMAIN>` carga la página de login; recargar la
página en una pestaña que no sea la raíz sigue funcionando (el respaldo SPA
funciona).

---

## Fase 7 — Verificación (hazlas todas)

### 7.1 Zona horaria

```bash
sudo -u parranda TZ=America/Havana /opt/parranda/backend/venv/bin/python \
  -c "from datetime import date, datetime; print(date.today(), datetime.now())"
```

Debe coincidir con la fecha y hora reales de La Habana. **Vuelve a comprobarlo
después de las 20:00 hora de La Habana** — ese es el momento en que un servidor
mal configurado en UTC se desvía.

### 7.2 Pestaña Stock — demuestra la vía a MySQL de extremo a extremo

Abre la pestaña Stock. Todos los territorios deben devolver datos y
`territorios_fallidos` debe estar vacío. Esta es la mejor prueba de que la Fase 3
funcionó. Recuerda que Moa y Palma Soriano legítimamente no tienen datos antes
del 2026-07-15 (§3.12).

### 7.3 Refresh — demuestra `requests` y la API de pedidos

Ejecuta un refresh sobre un rango de fechas pequeño. Vigila que:
- los 9 territorios terminen con éxito
- el pseudo-territorio "Pedidos" termine con éxito (esto es lo que falla si falta
  `requests`, según 1.2)

### 7.4 Autenticación y permisos de pestañas

Inicia sesión como admin y como el usuario `Parranda` (viewer). En Admin →
Usuarios, activa y desactiva cada una de las 6 pestañas por separado y confirma
que cada selección se guarda — incluyendo quitar "Real vs Meta" manteniendo
"Pedidos" (el error corregido el 2026-08-03 en `routes/users.py:19`).

### 7.5 Comprobación completa

Ejecuta `/smoke-check` contra la URL del VPS. Recorre todos los endpoints y
maneja la interfaz pestaña por pestaña.

### 7.6 Contrastar los números

Compara el HL total del mes en curso y el HL por territorio contra las cifras de
referencia capturadas en 1.4. Cualquier discrepancia aquí casi con seguridad
significa zona horaria (7.1) o un fallo parcial de stock/ETL (7.2/7.3) — no un
problema de datos.

---

## Fase 8 — Endurecimiento y operación

1. **Limitar la tasa de intentos de login.** No hay bloqueo por intentos
   fallidos. Añade un `limit_req` de nginx sobre `/api/auth/login`.
2. **Respaldos.** `pg_dump` nocturno de `parranda`, guardado fuera del servidor.
   Esta base contiene las metas, que no existen en ningún otro lugar.
3. **Rotar la contraseña de admin** después del cambio, usando los nuevos
   controles de mostrar/generar en Admin → Usuarios.
4. **Rotación de logs** para gunicorn/journald.
5. **Monitorear el túnel.** Si WireGuard se cae, Stock y el refresh fallan
   mientras el resto del dashboard se ve perfectamente sano — un fallo fácil de
   pasar por alto.

---

## Plan de reversión

La máquina Windows no se toca durante este proceso, así que revertir consiste en
apuntar a los usuarios de vuelta al dashboard local y detener el sitio de nginx
en el VPS. Dos advertencias:

- Cualquier pedido o venta refrescado **solo** en el VPS después del cambio no
  existirá localmente. Ejecuta un refresh local que cubra ese período.
- Si rotaste la contraseña de admin en el VPS, la copia local todavía tiene la
  anterior.

Mantén la instalación de Windows intacta hasta que el VPS haya funcionado
limpiamente durante un cierre de mes completo (Real vs Meta es la pestaña más
sensible a las fechas, y el cierre de mes es cuando afloran los errores de zona
horaria).

---

## Resumen de trampas conocidas

| Trampa | Dónde | Síntoma si se pasa por alto |
|---|---|---|
| El stock es solo consulta en vivo | `routes/stock.py:19`, §3.6 | Pestaña Stock muerta si el VPS no alcanza MySQL |
| `seed_database()` solo corre en `__main__` | `app.py:118` | Todo responde 500 en una base nueva — el entrypoint Docker (`entrypoint.sh`) lo llama; en manual hay que ejecutarlo a mano |
| `date.today()` × 11 usa el reloj del servidor | `routes/*.py` | "Ayer"/días incorrectos después de las 20:00 de La Habana — fija `TZ=America/Havana` (env var Docker o systemd) |
| Falta `requests` en requirements | `etl/pedidos_extract.py:22` | El refresh de Pedidos falla |
| Lock del ETL dentro del proceso | `refresh.py:33` | Refreshes concurrentes si `-w > 1` — el Dockerfile y la unidad usan `-w 1 --threads 8` |
| `ventas_cliente` usa `DO NOTHING` | §3.8 | Volver a correr el ETL ≠ restaurar el respaldo — restaura el `pg_dump` sobre el volumen `pgdata` |
| `API_BASE` relativo | `constants.js:175` | Necesita proxy de nginx en el mismo origen |
