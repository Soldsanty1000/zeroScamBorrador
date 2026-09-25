import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from './jwt';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    return context.switchToHttp().getRequest().user;
  },
);
