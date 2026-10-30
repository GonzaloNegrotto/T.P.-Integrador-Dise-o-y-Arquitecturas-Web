"""Agregar roles de usuario

Revision ID: 9f924fd7ab9c
Revises: e401c16bc0e9
Create Date: 2026-10-29 00:09:43.655244

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9f924fd7ab9c'
down_revision = 'e401c16bc0e9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('nombre', sa.String(length=30), nullable=False),
    sa.Column('descripcion', sa.String(length=120), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('nombre')
    )

    op.bulk_insert(
        sa.table(
            'roles',
            sa.column('nombre', sa.String(length=30)),
            sa.column('descripcion', sa.String(length=120)),
        ),
        [
            {'nombre': 'superadmin', 'descripcion': 'Acceso total a la aplicación.'},
            {'nombre': 'admin de usuarios', 'descripcion': 'Administra las cuentas de usuarios.'},
            {'nombre': 'editor', 'descripcion': 'Gestiona y edita el contenido.'},
            {'nombre': 'visitante', 'descripcion': 'Acceso básico asignado al registrarse.'},
        ],
    )

    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rol_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_usuarios_rol_id'), ['rol_id'], unique=False)
        batch_op.create_foreign_key('fk_usuarios_rol_id_roles', 'roles', ['rol_id'], ['id'])

    op.execute(
        sa.text(
            "UPDATE usuarios SET rol_id = "
            "(SELECT id FROM roles WHERE nombre = 'visitante') "
            "WHERE rol_id IS NULL"
        )
    )

    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.alter_column('rol_id', existing_type=sa.Integer(), nullable=False)


def downgrade():
    with op.batch_alter_table('usuarios', schema=None) as batch_op:
        batch_op.drop_constraint('fk_usuarios_rol_id_roles', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_usuarios_rol_id'))
        batch_op.drop_column('rol_id')

    op.drop_table('roles')
