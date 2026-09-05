function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var ${name}`)
  return value
}

export const env = {
  get tableName() {
    return required('TABLE_NAME')
  },
  get workerFunctionName() {
    return required('WORKER_FUNCTION_NAME')
  },
  get anthropicSecretArn() {
    return required('ANTHROPIC_SECRET_ARN')
  },
}

export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
