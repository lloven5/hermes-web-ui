let gatewayManager: any = null

export function getGatewayManagerInstance(): any {
  return gatewayManager
}

export async function initGatewayManager(): Promise<void> {
  const { GatewayManager } = await import('./hermes/gateway-manager')
  const { getActiveProfileName } = await import('./hermes/hermes-profile')
  const activeProfile = getActiveProfileName()
  gatewayManager = new GatewayManager(activeProfile)

  await gatewayManager.detectAllOnStartup()
  const gatewayRun = process.env.HERMES_GATEWAY_RUN?.trim().toLowerCase()
  if (gatewayRun === 'false' || gatewayRun === '0') {
    console.log('[bootstrap] HERMES_GATEWAY_RUN disabled, skipping gateway startAll')
  } else {
    await gatewayManager.startAll()
  }
}
