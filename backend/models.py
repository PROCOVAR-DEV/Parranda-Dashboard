"""SQLAlchemy ORM models for the Procovar - Parranda PostgreSQL database."""
from datetime import datetime

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, BigInteger,
    Numeric, String, UniqueConstraint, func,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Territory(Base):
    """Canonical territory reference (9 territories — Bayamo excluded)."""
    __tablename__ = "territories"

    id = Column(Integer, primary_key=True)
    nombre = Column(String(100), nullable=False, unique=True)
    orden = Column(Integer, nullable=False)

    def to_dict(self) -> dict:
        return {"id": self.id, "nombre": self.nombre, "orden": self.orden}


class SKU(Base):
    """The 5 tracked Parranda/Malta SKUs (fixed catalog, seeded at startup)."""
    __tablename__ = "skus"

    id = Column(Integer, primary_key=True)
    codigo = Column(String(20), nullable=False, unique=True)   # P1500, P500, P330, M1500, M330
    nombre = Column(String(200), nullable=False)
    hl_factor = Column(Numeric(8, 4), nullable=False)
    orden = Column(Integer, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "codigo": self.codigo,
            "nombre": self.nombre,
            "hl_factor": float(self.hl_factor),
            "orden": self.orden,
        }


class Venta(Base):
    """Sales fact table. One row = one SKU × one territory × one date (blisters)."""
    __tablename__ = "ventas"

    id = Column(Integer, primary_key=True)
    fecha = Column(Date, nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    cantidad = Column(Integer, nullable=False, default=0)        # blisters
    importe_usd = Column(Numeric(12, 2), nullable=False, default=0.00)
    inserted_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("fecha", "territory_id", "sku_id", name="uq_venta_fecha_territory_sku"),
        Index("idx_ventas_fecha", "fecha"),
    )


class Devolucion(Base):
    """Returns fact table (OperType 34). Same shape as ventas."""
    __tablename__ = "devoluciones"

    id = Column(Integer, primary_key=True)
    fecha = Column(Date, nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    cantidad = Column(Integer, nullable=False, default=0)
    importe_usd = Column(Numeric(12, 2), nullable=False, default=0.00)
    inserted_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("fecha", "territory_id", "sku_id", name="uq_devolucion_fecha_territory_sku"),
        Index("idx_dev_fecha", "fecha"),
    )


class VentaCliente(Base):
    """
    Client-level sales rows (Parranda SKUs only).
    partner_id is local per territory — never deduplicate across territories.
    """
    __tablename__ = "ventas_cliente"

    id = Column(Integer, primary_key=True)
    fecha = Column(Date, nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    partner_id = Column(Integer, nullable=False)
    partner_nombre = Column(String(500), nullable=False)
    acct = Column(BigInteger, nullable=False)

    __table_args__ = (
        UniqueConstraint("fecha", "territory_id", "sku_id", "partner_id", "acct",
                         name="uq_venta_cliente"),
        Index("idx_vc_fecha", "fecha"),
        Index("idx_vc_territory", "territory_id"),
        Index("idx_vc_partner", "partner_id"),
    )


class Pedido(Base):
    """
    One pedido raised in the Sistema de Pedidos (only those containing at least
    one Parranda SKU are stored). `folio` is the join key to AxisPos: the
    facturador pastes "P-<folio>; ..." into operations.Note.

    estado is the pedidos-system status: en_proceso | completada | expirada.
    A pedido being `completada` there does NOT mean it was invoiced in AxisPos —
    that is exactly the gap this tab measures.
    """
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True)
    pedido_ext_id = Column(String(40), nullable=False, unique=True)   # cuid from the API
    folio = Column(String(60), nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    sucursal_codigo = Column(String(10), nullable=False, default="")
    vendedor = Column(String(200), nullable=False, default="")
    cliente_codigo = Column(String(60), nullable=True)
    cliente_nombre = Column(String(500), nullable=False, default="")
    estado = Column(String(20), nullable=False, default="en_proceso")
    fecha = Column(Date, nullable=False)
    fecha_comprometida = Column(Date, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    requiere_domicilio = Column(Boolean, nullable=False, default=False)
    pedido_cobrado = Column(String(20), nullable=True)
    archivado = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    items = relationship("PedidoItem", back_populates="pedido", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_pedidos_fecha", "fecha"),
        Index("idx_pedidos_folio", "folio"),
        Index("idx_pedidos_territory", "territory_id"),
    )


class PedidoItem(Base):
    """
    One Parranda line of a pedido. Non-Parranda lines are dropped at extraction,
    so a pedido's stored lines are always a subset of what the vendedor raised.

    cantidad is in BLISTERS (pedidos-side `packs`), matching AxisPos `cantidad`
    and ventas.cantidad. `unidades` is kept only for display.
    """
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    cantidad = Column(Integer, nullable=False, default=0)   # blisters
    unidades = Column(Integer, nullable=False, default=0)

    pedido = relationship("Pedido", back_populates="items")

    __table_args__ = (
        UniqueConstraint("pedido_id", "sku_id", name="uq_pedido_item"),
    )


class FacturaObservacion(Base):
    """
    One AxisPos invoice (Acct) carrying Parranda lines, with its observacion.

    folio_extraido is the "P-<folio>" pulled out of the note, or NULL when the
    facturador pasted nothing / free text. Rows with a NULL folio are the
    "facturas sin código" metric: without it a territory that simply doesn't
    follow the paste procedure (Palma Soriano pastes it on 0% of invoices, Havana
    on ~32%) looks identical to one whose pedidos genuinely failed to convert.
    """
    __tablename__ = "facturas_observacion"

    id = Column(Integer, primary_key=True)
    fecha = Column(Date, nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    acct = Column(BigInteger, nullable=False)
    partner_id = Column(Integer, nullable=False, default=0)
    partner_nombre = Column(String(500), nullable=False, default="")
    observacion = Column(String(1000), nullable=False, default="")
    folio_extraido = Column(String(60), nullable=True)
    cantidad = Column(Integer, nullable=False, default=0)          # blisters
    importe_usd = Column(Numeric(12, 2), nullable=False, default=0.00)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("fecha", "territory_id", "acct", name="uq_factura_obs"),
        Index("idx_fobs_folio", "folio_extraido"),
        Index("idx_fobs_fecha", "fecha"),
    )


class RefreshLog(Base):
    """Tracks ETL refresh runs for status polling."""
    __tablename__ = "refresh_log"

    id = Column(Integer, primary_key=True)
    # datetime.now (reloj de Python, TZ=America/Havana) y NO func.now(): func.now()
    # usa el reloj de POSTGRES, que va en UTC. Con uno de cada, started_at y
    # finished_at quedaban a 4 horas de distancia y la duracion salia NEGATIVA.
    # El CLAUDE.md avisa de esto: los errores de zona horaria dan numeros
    # silenciosamente incorrectos, no errores visibles.
    started_at = Column(DateTime, default=datetime.now)
    finished_at = Column(DateTime, nullable=True)
    status = Column(String(20), nullable=False, default="running")  # running | ok | partial | error
    rows_upserted = Column(Integer, default=0)
    failed_territories = Column(String(500), default="")
    error_message = Column(String(1000), nullable=True)


class ReportCache(Base):
    """Reportes ya calculados.

    Cada pestania rehacia su consulta entera en cada carga, y con varias personas
    mirando lo mismo la base repetia el mismo trabajo una vez por persona. Aqui se
    guarda el resultado y se rehace solo cuando cambian los datos de verdad
    (ver cache_reportes.version_datos).

    `version` es la huella de los datos con la que se calculo: si no coincide con
    la de ahora, lo guardado no vale y se ignora. No hace falta borrar nada al
    correr el ETL — lo viejo deja de coincidir solo, que es mas seguro que
    acordarse de invalidar.
    """

    __tablename__ = "report_cache"

    cache_key = Column(String(500), primary_key=True)
    version = Column(String(200), nullable=False)
    payload = Column(JSONB, nullable=False)
    computed_at = Column(DateTime, default=datetime.now)
    # Para saber que reportes se usan de verdad y cuales llevan semanas sin
    # abrirse, y poder tirar solo esos.
    last_read_at = Column(DateTime, default=datetime.now)

    __table_args__ = (Index("idx_report_cache_last_read", "last_read_at"),)


class User(Base):
    """
    Dashboard user. role: admin (full control) | viewer (read-only data tabs).
    allowed_tabs: comma-separated tab keys the user can see; NULL/empty = all tabs.
    allowed_territories: comma-separated territory names; NULL/empty = all.
    Admins always see every tab and every territory regardless of these fields.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(80), nullable=False, unique=True)
    password_hash = Column(String(200), nullable=False)
    display_name = Column(String(120), nullable=False, default="")
    role = Column(String(20), nullable=False, default="viewer")  # admin | viewer
    active = Column(Boolean, nullable=False, default=True)
    allowed_tabs = Column(String(200), nullable=True)
    # Territorios que puede ver, separados por comas. NULL/vacio = TODOS.
    #
    # Mismo patron que `allowed_tabs` a proposito: una sola forma de decir "esto
    # lo ve y esto no". Sirve para dar una cuenta a cada sucursal que solo vea
    # lo suyo.
    #
    # Se guarda el NOMBRE del territorio (Havana, Camaguey...), no un id, porque
    # es lo que usan los filtros de todas las consultas y lo que devuelve
    # /api/territorios: asi no hay que traducir en cada sitio.
    #
    # OJO: el admin lo ve TODO, ignore lo que ponga aqui.
    allowed_territories = Column(String(400), nullable=True)
    created_at = Column(DateTime, default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "active": self.active,
            "allowed_tabs": [t for t in (self.allowed_tabs or "").split(",") if t] or None,
            "allowed_territories": [
                t for t in (self.allowed_territories or "").split(",") if t
            ] or None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Meta(Base):
    """Monthly sales target in HL per SKU per territory. mes = first day of month."""
    __tablename__ = "metas"

    id = Column(Integer, primary_key=True)
    mes = Column(Date, nullable=False)
    territory_id = Column(Integer, ForeignKey("territories.id"), nullable=False)
    sku_id = Column(Integer, ForeignKey("skus.id"), nullable=False)
    hl = Column(Numeric(10, 2), nullable=False, default=0)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("mes", "territory_id", "sku_id", name="uq_meta_mes_territory_sku"),
        Index("idx_metas_mes", "mes"),
    )


class MetaMonthConfig(Base):
    """Optional per-month override of total working days (blank = auto Mon-Fri)."""
    __tablename__ = "meta_month_config"

    id = Column(Integer, primary_key=True)
    mes = Column(Date, nullable=False, unique=True)
    dias_totales = Column(Integer, nullable=True)
