# Deploy Docker + Dokploy — Dashboard Procovar Parranda

Guía autónoma para desplegar el dashboard en el VPS `179.198.107.1`
sirviendo `ccsa.procovar.cloud`. Sustituye el flujo manual de `VPS_MIGRATION.md`
(Fases 2, 5 y 6) por contenedores Docker. Las reglas de negocio (§3 del
CLAUDE.md) y el bloqueante de red hacia AxisPos (§0.1 de `VPS_MIGRATION.md`)
siguen aplicando.

---

## 1. Requisitos previos

- VPS Ubuntu 22.04/24.04 con acceso SSH.
- Dominio `ccsa.procovar.cloud` apuntando a `179.198.107.1` (registro A).
- Docker instalado en el VPS:
  ```bash
  apt update && apt install -y docker.io docker-compose-plugin
  systemctl enable --now docker
  ```

## 2. Archivos Docker incluidos

| Archivo | Función |
|---|---|
| `backend/Dockerfile` | Python 3.12-slim + `requirements.txt` |
| `backend/entrypoint.sh` | Llama `seed_database()` y arranca `gunicorn -w 1 --threads 8` |
| `frontend/Dockerfile` | Multi-stage: build node → nginx (sirve `dist/`) |
| `frontend/nginx.conf` | Sirve `dist/`, fallback SPA, proxy `/api` → `backend:5051` |
| `docker-compose.yml` | Servicios `db`, `backend`, `frontend` |
| `.env.example` | Plantilla de secretos (renombrar/copiar a `.env`) |

## 3. Secretos

Copia `.env.example` como `/opt/parranda/.env` y ajusta los valores. No lo subas
a Git ni lo incluyas en la imagen (`.dockerignore` ya excluye `config.json` y
`.jwt_secret`). Variables:

| Variable | Obligatoria | Notas |
|---|---|---|
| `PG_PASSWORD` | sí | Postgres |
| `JWT_SECRET_KEY` | sí | Si cambia, todos revuelven a loguear |
| `PEDIDOS_API_KEY` | sí | Clave pedidos (Super Admin) |
| `AXISPOS_HOST` | no | Host del túnel hacia AxisPos MySQL |
| `PEDIDOS_API_URL` | no | `https://pedidos.procovar.cloud/api` |
| `CORS_ORIGINS` | no | `https://ccsa.procovar.cloud` |

Genera secretos fuertes con `openssl rand -hex 32`.

## 4. Respaldo de la base (en la máquina local)

```bash
pg_dump -U postgres -h localhost -Fc -d parranda -f parranda_YYYYMMDD.dump
```
No vuelvas a correr el ETL desde cero en el VPS: `ventas_cliente` usa upsert
`DO NOTHING` y el estado actual depende del orden de correcciones previas.

## 5. Subir el código al VPS

Desde tu máquina, excluyendo venv/node_modules/dist/secretos:

```bash
rsync -avz \
  --exclude 'backend/venv/' \
  --exclude 'backend/__pycache__/' \
  --exclude 'backend/config.json' \
  --exclude 'backend/.jwt_secret' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/dist/' \
  --exclude '.claude/' \
  --exclude '*.pyc' \
  "tu/carpeta/proyecto/" root@179.198.107.1:/opt/parranda/
```

## 6. Conexión a AxisPos (BLOQUEANTE)

`AXISPOS_HOST` debe ser alcanzable desde el VPS. Opciones:
- **A (recomendada):** túnel VPN (WireGuard) VPS → red local. Definir
  `AXISPOS_HOST=IP-del-tunel`.
- **B:** ETL dentro de la red local empujando al Postgres del VPS. ⚠️ Deja la
  pestaña Stock muerta para siempre (el stock solo se consulta en vivo).

## 7. Levantar el stack

```bash
cd /opt/parranda
cp /ruta/.env .env
docker compose --env-file .env up -d --build
docker compose ps
curl -s http://localhost/api/health
```

El entrypoint ejecuta `seed_database()` (idempotente) antes de gunicorn.

## 8. Restaurar la base de datos

```bash
cd /opt/parranda
docker compose cp /tmp/parranda.dump db:/tmp/db.dump
docker compose exec -T db pg_restore --clean --if-exists --no-owner \
  -U "$(grep PG_USER .env | cut -d= -f2)" -d "parranda" /tmp/db.dump
```
Verifica el conteo de filas contra lo anotado en el respaldo (Fase 4).

## 9. TLS y dominio

Se sirve `https://ccsa.procovar.cloud → frontend:80`; el `nginx.conf` del
contenedor ya reenvía `/api` al backend. Para TLS delante:

```bash
apt install -y nginx certbot python3-certbot-nginx
```
nginx reverse-proxy al puerto publicado del `frontend` (80) y luego:
```bash
certbot --nginx -d ccsa.procovar.cloud
```

(Dokploy/Traefik puede gestionar esto automáticamente si lo usas como
orquestador.)

## 10. Verificación

- [ ] `https://ccsa.procovar.cloud` carga el login
- [ ] Recargar en un enlace profundo funciona (fallback SPA)
- [ ] Pestaña Stock devuelve todos los territorios (prueba red AxisPos)
- [ ] Refresh: 9 territorios + "Pedidos" terminan OK
- [ ] HL de mes y por territorio coinciden con la referencia local
- [ ] `timedatectl` → `America/Havana` (crítico para "ayer"/stock/días)

## Trampas conocidas

| Trap | Síntoma |
|---|---|
| No alcanzar AxisPos | Pestaña Stock muerta y refresh falla parcial |
| `seed_database()` solo en `__main__` | Base nueva responde error — lo resuelve `entrypoint.sh` |
| Host en UTC | "Ayer"/días con desfase tras las 20:00 de La Habana |
| Falta `requests` en `requirements.txt` | Refresh de pedidos falla (ya corregido) |
| gunicorn con `-w > 1` | Refreshes concurrentes (usamos `-w 1 --threads 8`) |