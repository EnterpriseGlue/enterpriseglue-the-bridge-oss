import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getElementLinkInfo, updateElementLink, clearElementLink } from '@src/features/starbase/utils/bpmnLinking';

describe('bpmnLinking', () => {
  describe('getElementLinkInfo', () => {
    it('returns null for null element', () => {
      expect(getElementLinkInfo(null)).toBeNull();
    });

    it('returns null for undefined element', () => {
      expect(getElementLinkInfo(undefined)).toBeNull();
    });

    it('returns null for non-linkable element types', () => {
      const element = {
        id: 'el-1',
        businessObject: { $type: 'bpmn:Task' },
      };
      expect(getElementLinkInfo(element)).toBeNull();
    });

    describe('CallActivity', () => {
      it('returns link info for call activity with all properties', () => {
        const element = {
          id: 'el-1',
          businessObject: {
            $type: 'bpmn:CallActivity',
            calledElement: 'process-1',
            extensionElements: {
              values: [
                {
                  $type: 'camunda:Properties',
                  values: [
                    { name: 'starbase:fileId', value: 'file-1' },
                    { name: 'starbase:fileName', value: 'Process File' },
                  ],
                },
              ],
            },
          },
        };

        const info = getElementLinkInfo(element);
        expect(info).toEqual({
          elementId: 'el-1',
          elementType: 'CallActivity',
          linkType: 'process',
          targetKey: 'process-1',
          fileId: 'file-1',
          fileName: 'Process File',
        });
      });

      it('handles calledElement from get method', () => {
        const element = {
          id: 'el-1',
          businessObject: {
            $type: 'bpmn:CallActivity',
            get: (key: string) => (key === 'calledElement' ? 'process-2' : null),
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBe('process-2');
      });

      it('handles calledElement from $attrs', () => {
        const element = {
          id: 'el-1',
          businessObject: {
            $type: 'bpmn:CallActivity',
            $attrs: { 'camunda:calledElement': 'process-3' },
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBe('process-3');
      });

      it('returns null targetKey when calledElement is missing', () => {
        const element = {
          id: 'el-1',
          businessObject: { $type: 'bpmn:CallActivity' },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBeNull();
      });

      it('handles missing extension elements', () => {
        const element = {
          id: 'el-1',
          businessObject: {
            $type: 'bpmn:CallActivity',
            calledElement: 'process-1',
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.fileId).toBeNull();
        expect(info?.fileName).toBeNull();
      });

      it('handles extension elements from get method', () => {
        const element = {
          id: 'el-1',
          businessObject: {
            $type: 'bpmn:CallActivity',
            get: (key: string) => {
              if (key === 'extensionElements') {
                return {
                  values: [
                    {
                      $type: 'camunda:Properties',
                      values: [{ name: 'starbase:fileId', value: 'file-via-get' }],
                    },
                  ],
                };
              }
              return null;
            },
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.fileId).toBe('file-via-get');
      });
    });

    describe('BusinessRuleTask', () => {
      it('returns link info for business rule task', () => {
        const element = {
          id: 'el-2',
          businessObject: {
            $type: 'bpmn:BusinessRuleTask',
            decisionRef: 'decision-1',
          },
        };

        const info = getElementLinkInfo(element);
        expect(info).toEqual({
          elementId: 'el-2',
          elementType: 'BusinessRuleTask',
          linkType: 'decision',
          targetKey: 'decision-1',
          fileId: null,
          fileName: null,
        });
      });

      it('handles decisionRef from get method', () => {
        const element = {
          id: 'el-2',
          businessObject: {
            $type: 'bpmn:BusinessRuleTask',
            get: (key: string) => (key === 'decisionRef' ? 'decision-2' : null),
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBe('decision-2');
      });

      it('handles decisionRef from $attrs with camunda prefix', () => {
        const element = {
          id: 'el-2',
          businessObject: {
            $type: 'bpmn:BusinessRuleTask',
            $attrs: { 'camunda:decisionRef': 'decision-3' },
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBe('decision-3');
      });

      it('handles decisionRef from $attrs without prefix', () => {
        const element = {
          id: 'el-2',
          businessObject: {
            $type: 'bpmn:BusinessRuleTask',
            $attrs: { decisionRef: 'decision-4' },
          },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBe('decision-4');
      });

      it('returns null targetKey when decisionRef is missing', () => {
        const element = {
          id: 'el-2',
          businessObject: { $type: 'bpmn:BusinessRuleTask' },
        };

        const info = getElementLinkInfo(element);
        expect(info?.targetKey).toBeNull();
      });
    });

    it('handles element without businessObject', () => {
      const element = {
        id: 'el-1',
        $type: 'bpmn:CallActivity',
        calledElement: 'process-1',
      };

      const info = getElementLinkInfo(element);
      expect(info?.elementType).toBe('CallActivity');
      expect(info?.targetKey).toBe('process-1');
    });
  });

  describe('updateElementLink', () => {
    let modeling: any;
    let moddle: any;
    let modeler: any;

    beforeEach(() => {
      modeling = { updateProperties: vi.fn() };
      moddle = {
        create: vi.fn((type: string, props: any) => ({
          $type: type,
          ...props,
          values: props?.values || [],
        })),
      };
      modeler = {
        get: (key: string) => (key === 'modeling' ? modeling : moddle),
      };
    });

    it('does nothing if modeler is null', () => {
      updateElementLink(null, { businessObject: {} }, {
        linkType: 'process',
        targetKey: 'process-1',
        fileId: 'file-1',
        fileName: 'File 1',
      });

      expect(modeling.updateProperties).not.toHaveBeenCalled();
    });

    it('does nothing if element is null', () => {
      updateElementLink(modeler, null, {
        linkType: 'process',
        targetKey: 'process-1',
        fileId: 'file-1',
        fileName: 'File 1',
      });

      expect(modeling.updateProperties).not.toHaveBeenCalled();
    });

    it('updates process link with calledElement', () => {
      const element = { businessObject: { $type: 'bpmn:CallActivity' } };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-2',
        fileId: 'file-2',
        fileName: 'Process B',
      });

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          calledElement: 'process-2',
          extensionElements: expect.any(Object),
        })
      );
    });

    it('inherits the linked file name when a call activity name is empty', () => {
      const element = { businessObject: { $type: 'bpmn:CallActivity', name: '   ' } };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-2',
        fileId: 'file-2',
        fileName: 'Process B',
        inheritNameIfEmpty: true,
      });

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          calledElement: 'process-2',
          name: 'Process B',
          extensionElements: expect.any(Object),
        })
      );
    });

    it('does not overwrite an existing call activity name when inheriting on link', () => {
      const element = { businessObject: { $type: 'bpmn:CallActivity', name: 'Existing Call Activity' } };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-2',
        fileId: 'file-2',
        fileName: 'Process B',
        inheritNameIfEmpty: true,
      });

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.not.objectContaining({
          name: 'Process B',
        })
      );
    });

    it('updates decision link with decisionRef', () => {
      const element = { businessObject: { $type: 'bpmn:BusinessRuleTask' } };

      updateElementLink(modeler, element, {
        linkType: 'decision',
        targetKey: 'decision-2',
        fileId: 'file-2',
        fileName: 'Decision B',
      });

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          'camunda:decisionRef': 'decision-2',
          extensionElements: expect.any(Object),
        })
      );
    });

    it('creates extension elements if missing', () => {
      const element = { businessObject: {} };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-1',
        fileId: 'file-1',
        fileName: 'File 1',
      });

      expect(moddle.create).toHaveBeenCalledWith('bpmn:ExtensionElements', { values: [] });
      expect(modeling.updateProperties).toHaveBeenCalled();
    });

    it('creates properties if missing', () => {
      const element = {
        businessObject: {
          extensionElements: { values: [] },
        },
      };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-1',
        fileId: 'file-1',
        fileName: 'File 1',
      });

      expect(moddle.create).toHaveBeenCalledWith('camunda:Properties', { values: [] });
      expect(moddle.create).toHaveBeenCalledWith('camunda:Property', expect.any(Object));
    });

    it('updates existing properties', () => {
      const existingProp = { name: 'starbase:fileId', value: 'old-file' };
      const element = {
        businessObject: {
          extensionElements: {
            values: [
              {
                $type: 'camunda:Properties',
                values: [existingProp],
              },
            ],
          },
        },
      };

      updateElementLink(modeler, element, {
        linkType: 'process',
        targetKey: 'process-1',
        fileId: 'new-file',
        fileName: 'New File',
      });

      expect(modeling.updateProperties).toHaveBeenCalled();
    });
  });

  describe('clearElementLink', () => {
    let modeling: any;
    let moddle: any;
    let modeler: any;

    beforeEach(() => {
      modeling = { updateProperties: vi.fn() };
      moddle = {
        create: vi.fn((type: string, props: any) => ({
          $type: type,
          ...props,
          values: props?.values || [],
        })),
      };
      modeler = {
        get: (key: string) => (key === 'modeling' ? modeling : moddle),
      };
    });

    it('does nothing if modeler is null', () => {
      clearElementLink(null, { businessObject: {} }, 'process');
      expect(modeling.updateProperties).not.toHaveBeenCalled();
    });

    it('does nothing if element is null', () => {
      clearElementLink(modeler, null, 'process');
      expect(modeling.updateProperties).not.toHaveBeenCalled();
    });

    it('clears process link', () => {
      const element = { businessObject: {} };

      clearElementLink(modeler, element, 'process');

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          calledElement: null,
          extensionElements: expect.any(Object),
        })
      );
    });

    it('clears decision link', () => {
      const element = { businessObject: {} };

      clearElementLink(modeler, element, 'decision');

      expect(modeling.updateProperties).toHaveBeenCalledWith(
        element,
        expect.objectContaining({
          'camunda:decisionRef': null,
          extensionElements: expect.any(Object),
        })
      );
    });

    it('removes starbase properties', () => {
      const element = {
        businessObject: {
          extensionElements: {
            values: [
              {
                $type: 'camunda:Properties',
                values: [
                  { name: 'starbase:fileId', value: 'file-1' },
                  { name: 'starbase:fileName', value: 'File 1' },
                ],
              },
            ],
          },
        },
      };

      clearElementLink(modeler, element, 'process');

      expect(modeling.updateProperties).toHaveBeenCalled();
    });
  });
});
