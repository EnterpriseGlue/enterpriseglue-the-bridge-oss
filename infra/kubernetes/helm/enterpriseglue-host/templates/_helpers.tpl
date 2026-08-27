{{- define "enterpriseglue-host.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "enterpriseglue-host.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "enterpriseglue-host.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "enterpriseglue-host.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/part-of: enterpriseglue
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "enterpriseglue-host.selectorLabels" -}}
app.kubernetes.io/name: {{ include "enterpriseglue-host.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "enterpriseglue-host.backendImage" -}}
{{- $repository := required "images.backend.repository is required" .Values.images.backend.repository -}}
{{- $digest := required "images.backend.digest is required" .Values.images.backend.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail "images.backend.digest must be a sha256 digest" -}}
{{- end -}}
{{ printf "%s@%s" $repository $digest }}
{{- end }}

{{- define "enterpriseglue-host.frontendImage" -}}
{{- $repository := required "images.frontend.repository is required" .Values.images.frontend.repository -}}
{{- $digest := required "images.frontend.digest is required" .Values.images.frontend.digest -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $digest) -}}
{{- fail "images.frontend.digest must be a sha256 digest" -}}
{{- end -}}
{{ printf "%s@%s" $repository $digest }}
{{- end }}

{{- define "enterpriseglue-host.serviceAccountName" -}}
{{- $root := .root -}}
{{- $component := .component -}}
{{- $settings := index $root.Values.serviceAccounts $component -}}
{{- default (printf "%s-%s" (include "enterpriseglue-host.fullname" $root) $component) $settings.name -}}
{{- end }}

{{- define "enterpriseglue-host.podSecurityContext" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- if eq .Values.platform "kubernetes" }}
runAsUser: 65532
runAsGroup: 65532
fsGroup: 65532
{{- end }}
{{- end }}

{{- define "enterpriseglue-host.containerSecurityContext" -}}
allowPrivilegeEscalation: false
capabilities:
  drop: ["ALL"]
readOnlyRootFilesystem: true
runAsNonRoot: true
{{- end }}

{{- define "enterpriseglue-host.topologySpread" -}}
{{- if .root.Values.topologySpread.enabled }}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: {{ .root.Values.topologySpread.topologyKey }}
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "enterpriseglue-host.selectorLabels" (dict "root" .root "component" .component) | nindent 8 }}
{{- end }}
{{- end }}

{{- define "enterpriseglue-host.commonPodSpec" -}}
automountServiceAccountToken: false
securityContext:
  {{- include "enterpriseglue-host.podSecurityContext" . | nindent 2 }}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

