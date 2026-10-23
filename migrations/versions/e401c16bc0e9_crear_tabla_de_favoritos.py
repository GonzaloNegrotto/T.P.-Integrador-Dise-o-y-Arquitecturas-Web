"""Crear tabla de favoritos

Revision ID: e401c16bc0e9
Revises: 1452fa315cee
Create Date: 2026-10-23 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e401c16bc0e9'
down_revision = '1452fa315cee'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('favoritos',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('usuario_id', sa.Integer(), nullable=False),
    sa.Column('pelicula_id', sa.Integer(), nullable=False),
    sa.Column('titulo', sa.String(length=255), nullable=False),
    sa.Column('poster', sa.String(length=100), nullable=True),
    sa.Column('anio', sa.String(length=4), nullable=True),
    sa.Column('puntaje', sa.Float(), nullable=False),
    sa.Column('votos', sa.Integer(), nullable=False),
    sa.Column('generos', sa.JSON(), nullable=False),
    sa.Column('agregado_en', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['usuario_id'], ['usuarios.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('usuario_id', 'pelicula_id', name='uq_favoritos_usuario_pelicula')
    )
    with op.batch_alter_table('favoritos', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_favoritos_usuario_id'), ['usuario_id'], unique=False)


def downgrade():
    with op.batch_alter_table('favoritos', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_favoritos_usuario_id'))

    op.drop_table('favoritos')
