import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.category.findMany({ orderBy: { order: 'asc' } });
  }

  create(dto: CreateCategoryDto) {
    // El unique de name/slug lo garantiza la DB; el PrismaExceptionFilter
    // traduce la violación (P2002) a 409.
    return this.prisma.category.create({ data: dto });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoría no encontrada');
    return this.prisma.category.update({ where: { id }, data: dto });
  }
}
