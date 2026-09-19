import { FinanceService } from './finance.service';
describe('Incomplete finance data',()=>{
  const prisma={financialTransaction:{findMany:jest.fn()},order:{count:jest.fn()}};
  const service=new FinanceService(prisma as any);
  beforeEach(()=>{prisma.financialTransaction.findMany.mockResolvedValue([]);prisma.order.count.mockResolvedValue(2);});
  it('does not turn absent financial data into zero or a real DRE',async()=>{
    const result=await service.getDre('a',new Date(0),new Date());
    expect(result.grossRevenue).toBeNull();expect(result.marketplaceFees).toBeNull();expect(result.netProfit).toBeNull();expect(result.netMarginPct).toBeNull();expect(result.complete).toBe(false);
  });
  it('keeps observed values distinct from absent data and filters by tenant',async()=>{
    prisma.financialTransaction.findMany.mockResolvedValue([{type:'REVENUE',amount:100},{type:'REVENUE',amount:25},{type:'FEE',amount:0}]);
    const result=await service.getDre('b',new Date(0),new Date());
    expect(result.grossRevenue).toBe(125);expect(result.marketplaceFees).toBe(0);expect(result.productCosts).toBeNull();expect(result.netProfit).toBeNull();
    expect(prisma.financialTransaction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:'b'})}));
  });
  it('rejects invalid and reversed periods',async()=>{
    await expect(service.getDre('a',new Date('bad'),new Date())).rejects.toThrow();
    await expect(service.getDre('a',new Date(),new Date(0))).rejects.toThrow();
  });
});
