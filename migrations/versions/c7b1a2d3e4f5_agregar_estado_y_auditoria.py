"""Agregar estado de usuario y auditoria

Revision ID: c7b1a2d3e4f5
Revises: 9f924fd7ab9c
Create Date: 2026-11-16 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "c7b1a2d3e4f5"
down_revision = "9f924fd7ab9c"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("usuarios", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("estado", sa.String(length=10), server_default="activo", nullable=True)
        )

    op.execute("UPDATE usuarios SET estado = 'activo' WHERE estado IS NULL")

    with op.batch_alter_table("usuarios", schema=None) as batch_op:
        batch_op.alter_column(
            "estado",
            existing_type=sa.String(length=10),
            nullable=False,
            server_default="activo",
        )

    op.create_table(
        "auditoria",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=True),
        sa.Column("accion", sa.String(length=40), nullable=False),
        sa.Column("entidad", sa.String(length=30), nullable=False),
        sa.Column("entidad_id", sa.Integer(), nullable=True),
        sa.Column("detalle", sa.JSON(), nullable=False),
        sa.Column("fecha", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuarios.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("auditoria", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_auditoria_usuario_id"), ["usuario_id"], unique=False)


def downgrade():
    with op.batch_alter_table("auditoria", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_auditoria_usuario_id"))
    op.drop_table("auditoria")

    with op.batch_alter_table("usuarios", schema=None) as batch_op:
        batch_op.drop_column("estado")
