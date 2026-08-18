export interface DeployResult {
  url: string;
}

export async function deployVercelRelay(
  token: string,
  projectName?: string,
): Promise<DeployResult> {
  // TODO(M4): upload the relay worker to vercel via the rest api, poll the
  // deployment until live (~10-40s), return its url.
  void token;
  void projectName;
  throw new Error("TODO(M4): deployVercelRelay not implemented");
}
