import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectCamundaEngine, validateAndUploadFile } from '@src/features/starbase/utils/uploadValidation';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

vi.mock('@src/shared/api/apiErrorUtils', () => ({
  parseApiError: vi.fn((error, message) => ({
    message,
    status: error.status || 500,
  })),
}));

describe('uploadValidation', () => {
  describe('detectCamundaEngine', () => {
    it('detects Camunda 7 from standard BPMN', () => {
      const xmlString = `
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                     xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
          <process id="test"/>
        </definitions>
      `;
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlString, 'application/xml');
      
      const result = detectCamundaEngine(xml);
      
      expect(result.isCamunda7).toBe(true);
      expect(result.isCamunda8).toBe(false);
    });

    it('detects Camunda 8 from Zeebe namespace', () => {
      const xmlString = `
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                     xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
          <process id="test"/>
        </definitions>
      `;
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlString, 'application/xml');
      
      const result = detectCamundaEngine(xml);
      
      expect(result.isCamunda7).toBe(false);
      expect(result.isCamunda8).toBe(true);
    });

    it('detects Camunda 8 from zeebe elements', () => {
      const xmlString = `
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                     xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">
          <process id="test">
            <serviceTask id="task">
              <zeebe:taskDefinition type="test"/>
            </serviceTask>
          </process>
        </definitions>
      `;
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlString, 'application/xml');
      
      const result = detectCamundaEngine(xml);
      
      expect(result.isCamunda8).toBe(true);
    });

    it('defaults to Camunda 7 for plain BPMN', () => {
      const xmlString = `
        <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
          <process id="test"/>
        </definitions>
      `;
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlString, 'application/xml');
      
      const result = detectCamundaEngine(xml);
      
      expect(result.isCamunda7).toBe(true);
      expect(result.isCamunda8).toBe(false);
    });
  });

  describe('validateAndUploadFile', () => {
    const mockQueryClient = {
      invalidateQueries: vi.fn(),
    };
    const mockShowToast = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('does not acknowledge an empty creation response', async () => {
      const file = { name: 'test.bpmn', text: vi.fn().mockResolvedValue('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>') } as any;
      vi.mocked(apiClient.post).mockResolvedValue({});
      await validateAndUploadFile({ file, projectId: '11111111-1111-4111-8111-111111111111', folderId: null, queryClient: mockQueryClient as any, showToast: mockShowToast });
      expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    });

    it('rejects malformed XML even when root opening and closing tags exist', async () => {
      const file = { name: 'test.bpmn', text: vi.fn().mockResolvedValue('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process></definitions>') } as any;
      await validateAndUploadFile({ file, projectId: '11111111-1111-4111-8111-111111111111', folderId: null, queryClient: mockQueryClient as any, showToast: mockShowToast });
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('rejects non-BPMN/DMN files', async () => {
      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'Only .bpmn and .dmn files are supported.',
      });
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('handles file read errors', async () => {
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockRejectedValue(new Error('Read error')),
      } as any;

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'Could not read file contents.',
      });
    });

    it('rejects invalid XML', async () => {
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue('not xml'),
      } as any;

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'File is not valid XML.',
      });
    });

    it('rejects non-BPMN/DMN definitions', async () => {
      const xmlContent = '<root><element/></root>';
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'File is not a BPMN or DMN definition.',
      });
    });

    it('rejects Camunda 8 diagrams', async () => {
      const xmlContent = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"><process id="test"/></definitions>`;
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'Camunda 8 / Zeebe diagrams are not supported. Please upload a Camunda 7 BPMN/DMN file.',
      });
    });

    it('successfully uploads valid BPMN file', async () => {
      const xmlContent = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="test"/></definitions>`;
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;
      vi.mocked(apiClient.post).mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', name: file.name, type: file.name.endsWith('.dmn') ? 'dmn' : 'bpmn', bpmnProcessId: null, dmnDecisionId: null, createdAt: 1, updatedAt: 1 });

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: '22222222-2222-4222-8222-222222222222',
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/starbase-api/projects/11111111-1111-4111-8111-111111111111/files',
        {
          type: 'bpmn',
          name: 'test.bpmn',
          folderId: '22222222-2222-4222-8222-222222222222',
          xml: xmlContent,
        }
      );
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['contents', '11111111-1111-4111-8111-111111111111'],
      }, { throwOnError: true });
      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'success',
        title: 'File uploaded',
        subtitle: 'test.bpmn',
      });
    });

    it('successfully uploads valid DMN file', async () => {
      const xmlContent = `<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd" xmlns:dmn="http://www.omg.org/spec/DMN/20151101/dmn.xsd"><decision id="test"/></definitions>`;
      const file = {
        name: 'test.dmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;
      vi.mocked(apiClient.post).mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333', name: file.name, type: file.name.endsWith('.dmn') ? 'dmn' : 'bpmn', bpmnProcessId: null, dmnDecisionId: null, createdAt: 1, updatedAt: 1 });

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/starbase-api/projects/11111111-1111-4111-8111-111111111111/files',
        {
          type: 'dmn',
          name: 'test.dmn',
          folderId: null,
          xml: xmlContent,
        }
      );
    });

    it('handles 409 conflict errors', async () => {
      const xmlContent = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="test"/></definitions>`;
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;
      vi.mocked(apiClient.post).mockRejectedValue({ status: 409 });

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'A file with this name already exists in this folder.',
      });
    });

    it('handles general upload errors', async () => {
      const xmlContent = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="test"/></definitions>`;
      const file = {
        name: 'test.bpmn',
        text: vi.fn().mockResolvedValue(xmlContent),
      } as any;
      vi.mocked(apiClient.post).mockRejectedValue(new Error('Network error'));

      await validateAndUploadFile({
        file,
        projectId: '11111111-1111-4111-8111-111111111111',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).toHaveBeenCalledWith({
        kind: 'error',
        title: 'Upload failed',
        subtitle: 'Upload result was not verified. Refresh project contents before retrying.',
      });
    });

    it('returns early if projectId is missing', async () => {
      const file = new File(['content'], 'test.bpmn', { type: 'text/xml' });

      await validateAndUploadFile({
        file,
        projectId: '',
        folderId: null,
        queryClient: mockQueryClient as any,
        showToast: mockShowToast,
      });

      expect(mockShowToast).not.toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });
});
