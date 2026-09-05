const fetchRequest = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    return await fetchRequest(...args);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
    console.error(
      JSON.stringify({
        networkDiagnostic: true,
        time: new Date().toISOString(),
        name: error instanceof Error ? error.name : 'unknown',
        causeCode: typeof code === 'string' ? code : null,
      }),
    );
    throw error;
  }
};
