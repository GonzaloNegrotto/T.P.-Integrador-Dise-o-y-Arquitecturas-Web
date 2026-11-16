"""Ajustar nombres y alcance del catálogo de roles

Revision ID: d8e2f3a4b5c6
Revises: c7b1a2d3e4f5
Create Date: 2026-11-16 19:35:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "d8e2f3a4b5c6"
down_revision = "c7b1a2d3e4f5"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'superadministrador' "
            "WHERE nombre = 'superadmin'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'administrador' "
            "WHERE nombre = 'admin de usuarios'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'usuario', descripcion = 'Acceso básico de una cuenta registrada.' "
            "WHERE nombre = 'visitante'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE usuarios SET rol_id = "
            "(SELECT id FROM roles WHERE nombre = 'usuario') "
            "WHERE rol_id = (SELECT id FROM roles WHERE nombre = 'editor')"
        )
    )
    op.execute(sa.text("DELETE FROM roles WHERE nombre = 'editor'"))


def downgrade():
    op.bulk_insert(
        sa.table(
            "roles",
            sa.column("nombre", sa.String(length=30)),
            sa.column("descripcion", sa.String(length=120)),
        ),
        [{"nombre": "editor", "descripcion": "Gestiona y edita el contenido."}],
    )
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'visitante', descripcion = 'Acceso básico asignado al registrarse.' "
            "WHERE nombre = 'usuario'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'admin de usuarios' "
            "WHERE nombre = 'administrador'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE roles SET nombre = 'superadmin' "
            "WHERE nombre = 'superadministrador'"
        )
    )
