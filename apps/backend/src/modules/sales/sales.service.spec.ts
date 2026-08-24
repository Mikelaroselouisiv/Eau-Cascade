import { SalesService } from './sales.service';

describe('SalesService', () => {
  it('is defined', () => {
    const service = new SalesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(service).toBeDefined();
  });
});
