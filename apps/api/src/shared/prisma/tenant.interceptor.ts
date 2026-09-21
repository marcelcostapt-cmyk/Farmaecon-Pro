import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { inTenant } from './tenant-context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const principal = context
      .switchToHttp()
      .getRequest<{ user?: { tenantId?: string } }>().user;
    if (!principal?.tenantId) return next.handle();
    // Guards have already verified this principal. No body/query/header tenant is trusted.
    return new Observable((subscriber) =>
      inTenant(principal.tenantId!, () => next.handle().subscribe(subscriber)),
    );
  }
}
