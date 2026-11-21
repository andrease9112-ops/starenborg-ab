export function createPortalApi({ url, key }, request) {
  async function call(path, { token, headers, ...options } = {}) {
    const response = await request(url + path, {
      ...options,
      headers: {
        apikey: key,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...headers,
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error('Kundportalen kunde inte slutföra begäran.');
      error.status = response.status;
      error.portalCode = data?.code ?? data?.error;
      throw error;
    }
    return data;
  }

  async function exchange(grant, credentials) {
    const session = await call('/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!session?.access_token || !session.refresh_token || !session.user?.id) {
      throw new Error('Inloggningssvar saknas.');
    }

    const memberships = await call('/rest/v1/customer_members?select=customers(id,name)&user_id=eq.'
      + encodeURIComponent(session.user.id), { token: session.access_token });
    return {
      token: session.access_token,
      userId: session.user.id,
      email: session.user.email ?? credentials.email,
      refreshToken: session.refresh_token,
      expiresAt: Date.now() + (session.expires_in ?? 3600) * 1000,
      customers: memberships.map(member => member.customers).filter(Boolean),
    };
  }

  async function sendDocument(session, customerId, document, body) {
    if (!session.customers.some(customer => customer.id === customerId)) {
      throw new Error('Kundkontot saknar åtkomst till företaget.');
    }

    const token = session.token;
    const id = document.uploadId;
    const path = customerId + '/' + id;
    const documentQuery = '/rest/v1/customer_documents?select=id&id=eq.'
      + encodeURIComponent(id) + '&customer_id=eq.' + encodeURIComponent(customerId)
      + '&storage_path=eq.' + encodeURIComponent(path);
    const exists = async () => (await call(documentQuery, { token })).some(row => row.id === id);

    if (await exists()) return;
    try {
      await call('/storage/v1/object/customer-documents/'
        + encodeURIComponent(customerId) + '/' + encodeURIComponent(id), {
        token,
        method: 'POST',
        headers: { 'Content-Type': document.mime, 'x-upsert': 'false' },
        body,
      });
    } catch (error) {
      // A previous attempt can have stored this UUID before the metadata write.
      if (error.status !== 409 && !['Duplicate', 'ResourceAlreadyExists'].includes(error.portalCode)) {
        throw error;
      }
    }

    try {
      const rows = await call('/rest/v1/customer_documents', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          id,
          customer_id: customerId,
          filename: document.name,
          storage_path: path,
        }),
      });
      if (!rows?.some(row => row.id === id && row.storage_path === path)) {
        throw new Error('Kundportalen bekräftade inte underlaget.');
      }
    } catch (error) {
      if (!await exists()) throw error;
    }
  }

  return {
    login: (email, password) => exchange('password', { email, password }),
    refresh: refreshToken => exchange('refresh_token', { refresh_token: refreshToken }),
    sendDocument,
  };
}
