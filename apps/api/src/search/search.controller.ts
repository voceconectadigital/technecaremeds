/**
 * Aurora — busca global pela HTTP (SPEC v0.2 §27 · EPIC-025).
 *
 * Uma rota só, e nenhuma permissão no decorador: o corte é POR ESCOPO, dentro
 * da consulta. Um decorador exigiria uma permissão única para buscar, e quem
 * não a tivesse perderia a busca inteira — inclusive nos escopos que pode ler.
 */
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { withTenant, search, type Database } from '@aurora/db';
import { SCOPE_LABELS, ValidationError } from '@aurora/domain';
import { DATABASE } from '../common/tokens';
import type { AuroraRequest } from '../common/context.middleware';

@Controller('search')
export class SearchController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async search(
    @Req() req: AuroraRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string
  ): Promise<unknown> {
    const ctx = req.auroraContext!;

    if (typeof q !== 'string') {
      throw new ValidationError('informe o termo em "q"', { field: 'q' });
    }
    // Termo longo demais não é busca, é colagem acidental — e cada escopo o
    // levaria a uma varredura completa da tabela.
    if (q.length > 120) {
      throw new ValidationError('o termo de busca é longo demais', { field: 'q' });
    }

    const resultado = await withTenant(this.db, ctx, (s) =>
      search(s, q, { limit: limit ? Number(limit) : undefined })
    );

    return {
      ...resultado,
      // Os rótulos vêm junto para a tela agrupar sem ter a sua própria
      // tradução — e sem inventar um nome diferente do que o resto do produto
      // usa para a mesma coisa.
      scopeLabels: SCOPE_LABELS,
    };
  }
}
