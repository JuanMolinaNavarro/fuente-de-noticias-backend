import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFeedDto, UpdateFeedDto } from './dto/feed.dto';

@Injectable()
export class FeedsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.feed.findMany({
      include: { category: true },
      orderBy: { url: 'asc' },
    });
  }

  /** Lo que consume la ingesta: solo habilitados, con su categoría fija. */
  findEnabled() {
    return this.prisma.feed.findMany({
      where: { enabled: true },
      include: { category: true },
    });
  }

  create(dto: CreateFeedDto) {
    return this.prisma.feed.create({
      data: dto,
      include: { category: true },
    });
  }

  async update(id: string, dto: UpdateFeedDto) {
    const feed = await this.prisma.feed.findUnique({ where: { id } });
    if (!feed) throw new NotFoundException('Feed no encontrado');
    return this.prisma.feed.update({
      where: { id },
      data: dto,
      include: { category: true },
    });
  }
}
