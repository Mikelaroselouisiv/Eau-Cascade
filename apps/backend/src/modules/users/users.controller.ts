import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('users.view')
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Permissions('users.view')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Permissions('users.manage')
  create(
    @Body() createUserDto: CreateUserDto,
    @GetUser() actor?: { id?: number },
  ) {
    return this.usersService.create(createUserDto, actor?.id);
  }

  @Patch(':id')
  @Permissions('users.manage')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() actor?: { id?: number },
  ) {
    return this.usersService.update(id, updateUserDto, actor?.id);
  }

  @Delete(':id')
  @Permissions('users.manage')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() actor: { id: number },
  ) {
    return this.usersService.remove(id, actor.id);
  }
}
