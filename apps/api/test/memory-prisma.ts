// In-memory test double; never wired into the application. HTTP/SQL smoke tests cover the real adapter separately.
export class MemoryPrisma {
  rows: Record<string, any[]> = { user: [], tenant: [], authSession: [], oAuthState: [], marketplaceAccount: [], order: [], financialTransaction: [] };
  user: any; tenant: any; authSession: any; oAuthState: any; marketplaceAccount: any; order: any; financialTransaction: any;
  constructor() {
    for (const model of Object.keys(this.rows)) (this as any)[model] = this.model(model);
  }
  matches(row: any, where: any = {}): boolean {
    return Object.entries(where).every(([key, value]: [string, any]) => {
      if (value === undefined) return true;
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('gt' in value && !(row[key] > value.gt)) return false;
        if ('gte' in value && !(row[key] >= value.gte)) return false;
        if ('lte' in value && !(row[key] <= value.lte)) return false;
        if ('in' in value && !value.in.includes(row[key])) return false;
        if (['gt','gte','lte','in'].some(k => k in value)) return true;
        return this.matches(row, value); // Prisma compound unique input.
      }
      return row[key] === value;
    });
  }
  project(model: string, row: any, args: any): any {
    if (!row) return null;
    const data = { ...row };
    if (model === 'order') {
      data.marketplaceAccount = this.rows.marketplaceAccount.find(a => a.id === row.marketplaceAccountId);
      data.financialTransactions = this.rows.financialTransaction.filter(t => t.orderId === row.id);
    }
    if (model === 'marketplaceAccount') data._count = { orders: this.rows.order.filter(o => o.marketplaceAccountId === row.id).length };
    const relations: Record<string,string> = { marketplaceAccount: 'marketplaceAccount', financialTransactions: 'financialTransaction' };
    const projectField = (k: string, spec: any): any => {
      if (spec === true) return structuredClone(data[k]);
      if (Array.isArray(data[k])) return data[k].map((v: any) => this.project(relations[k], v, spec));
      return this.project(relations[k] ?? k, data[k], spec);
    };
    if (args.select) return Object.fromEntries(Object.entries(args.select).filter(([,v]) => v).map(([k,v]) => [k,projectField(k,v)]));
    const result = structuredClone(row);
    for (const [k,v] of Object.entries(args.include ?? {})) result[k] = projectField(k,v);
    return result;
  }
  model(name: string) {
    return {
      findFirst: jest.fn(async (args: any) => this.project(name, this.rows[name].find(r => this.matches(r,args.where)), args)),
      findUnique: jest.fn(async (args: any) => this.project(name, this.rows[name].find(r => this.matches(r,args.where)), args)),
      findFirstOrThrow: jest.fn(async (args: any) => { const row = this.rows[name].find(r => this.matches(r,args.where)); if (!row) throw new Error('not found'); return this.project(name,row,args); }),
      findUniqueOrThrow: jest.fn(async (args: any) => { const row = this.rows[name].find(r => this.matches(r,args.where)); if (!row) throw new Error('not found'); return this.project(name,row,args); }),
      findMany: jest.fn(async (args: any = {}) => this.rows[name].filter(r => this.matches(r,args.where)).slice(args.skip ?? 0, args.take ? (args.skip ?? 0)+args.take : undefined).map(r => this.project(name,r,args))),
      count: jest.fn(async (args: any) => this.rows[name].filter(r => this.matches(r,args.where)).length),
      create: jest.fn(async (args: any) => { const row = { id: `${name}-${this.rows[name].length}`, createdAt: new Date(), revokedAt: null, consumedAt: null, ...args.data }; this.rows[name].push(row); return this.project(name,row,args); }),
      updateMany: jest.fn(async (args: any) => { const found=this.rows[name].filter(r=>this.matches(r,args.where)); found.forEach(r=>Object.assign(r,args.data)); return { count: found.length }; }),
      upsert: jest.fn(async (args: any) => { let row=this.rows[name].find(r=>this.matches(r,args.where)); if (row) Object.assign(row,args.update); else { row={id:`${name}-${this.rows[name].length}`,createdAt:new Date(),status:'ACTIVE',...args.create};this.rows[name].push(row); } return this.project(name,row,args); }),
    };
  }
  async $transaction(arg: any) { return typeof arg === 'function' ? arg(this) : Promise.all(arg); }
}
