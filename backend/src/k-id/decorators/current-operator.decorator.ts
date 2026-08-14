import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedOperator {
  id: string;
  role: string;
}

export const CurrentOperator = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedOperator => {
  const request = ctx.switchToHttp().getRequest();
  return request.operator;
});
