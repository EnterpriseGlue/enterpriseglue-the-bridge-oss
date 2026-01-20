import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const cwdConfigPath = path.resolve(
  process.cwd(),
  'local-docs/ING/api-specs/Mission-Control-Mock-Server-Config.json'
);
const repoRootConfigPath = path.resolve(
  process.cwd(),
  '..',
  'local-docs/ING/api-specs/Mission-Control-Mock-Server-Config.json'
);

const mockConfigPath = existsSync(cwdConfigPath) ? cwdConfigPath : repoRootConfigPath;

const mockConfig = JSON.parse(readFileSync(mockConfigPath, 'utf8')) as {
  mock: {
    examples: {
      processDefinitions: Record<string, { key: string; name: string; version: number }>;
      processInstances: {
        active: Array<{ id: string; businessKey: string; processDefinitionKey: string; state: string }>;
      };
      decisions: Array<{ id: string; key: string; name: string; version: number }>;
    };
  };
};

const processDefinitions = Object.values(mockConfig.mock.examples.processDefinitions).map((def) => ({
  id: `${def.key}:${def.version}:mock`,
  key: def.key,
  name: def.name,
  version: def.version,
  deploymentId: 'deployment-mock',
}));

const decisionDefinitions = mockConfig.mock.examples.decisions;

const processInstances = mockConfig.mock.examples.processInstances.active.map((inst) => ({
  id: inst.id,
  definitionId: `${inst.processDefinitionKey}:1:mock`,
  businessKey: inst.businessKey,
  ended: false,
  suspended: inst.state === 'SUSPENDED',
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    headers: {
      get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/json' : undefined),
    },
  };
}

export function createCamundaFetchMock() {
  return async (url: string) => {
    const parsed = new URL(url);
    const pathName = parsed.pathname.replace(/\/engine-rest$/, '').replace('/engine-rest', '');

    if (pathName === '/version') {
      return jsonResponse({ version: '7.24.2-ee' });
    }

    if (pathName === '/deployment') {
      return jsonResponse([]);
    }

    if (pathName.startsWith('/deployment/')) {
      const id = pathName.split('/').pop();
      return jsonResponse({ id, name: 'mock-deployment' });
    }

    if (pathName === '/decision-definition') {
      return jsonResponse(decisionDefinitions);
    }

    if (pathName.endsWith('/evaluate')) {
      return jsonResponse([{ result: 'approved' }]);
    }

    if (pathName.endsWith('/xml')) {
      return jsonResponse({ id: 'xml', dmnXml: '<definitions />', bpmn20Xml: '<definitions />' });
    }

    if (pathName.startsWith('/decision-definition/')) {
      return jsonResponse(decisionDefinitions[0] || { id: 'decision', key: 'decision', version: 1 });
    }

    if (pathName === '/process-definition') {
      return jsonResponse(processDefinitions);
    }

    if (pathName.startsWith('/process-definition/')) {
      return jsonResponse(processDefinitions[0]);
    }

    if (pathName === '/process-instance') {
      return jsonResponse(processInstances);
    }

    if (pathName.endsWith('/variables')) {
      return jsonResponse({});
    }

    if (pathName.endsWith('/activity-instances')) {
      return jsonResponse({ id: 'activity', childActivityInstances: [] });
    }

    if (pathName.startsWith('/process-instance/')) {
      return jsonResponse(processInstances[0]);
    }

    return jsonResponse({ message: 'not found' }, 404);
  };
}
