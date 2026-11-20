import { proxyUpload } from '../api-bridge';

export async function POST(request: Request) {
  return proxyUpload(request);
}
