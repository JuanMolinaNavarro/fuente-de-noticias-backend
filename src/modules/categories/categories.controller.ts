import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

/** Público: el nav del frontend arma las secciones desde acá. */
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list() {
    return this.categories.findAll();
  }
}

/** Gestión del catálogo. Un editor puede CREAR secciones (le surge al armar
 *  la portada); renombrar o reordenar lo existente sigue siendo de ADMIN
 *  porque afecta URLs y navegación ya publicadas. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Roles('ADMIN', 'EDITOR')
  list() {
    return this.categories.findAll();
  }

  @Post()
  @Roles('ADMIN', 'EDITOR')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }
}
