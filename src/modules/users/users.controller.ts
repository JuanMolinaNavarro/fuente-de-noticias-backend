import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CreateUserDto, SetPasswordDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

/** Gestión de la redacción. Sólo ADMIN salvo el directorio. Sin DELETE: los
 *  usuarios se desactivan (isActive=false) para no romper revisiones ni auditoría. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Directorio mínimo (id + nombre) para elegir firmas: cualquier rol. */
  @Get('directory')
  directory() {
    return this.users.directory();
  }

  @Roles('ADMIN')
  @Get()
  list() {
    return this.users.list();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser) {
    return this.users.create(dto, actor.id);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.users.update(id, dto, actor.id);
  }

  @Roles('ADMIN')
  @Post(':id/password')
  @HttpCode(204)
  async setPassword(
    @Param('id') id: string,
    @Body() dto: SetPasswordDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.users.setPassword(id, dto.password, actor.id);
  }
}
