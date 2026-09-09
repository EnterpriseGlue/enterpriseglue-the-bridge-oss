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

{{- define "enterpriseglue-host.releaseEffectCohortValidate" -}}
{{- if .Values.database.releaseEffectCohort.enabled -}}
{{- if or (ne .Values.database.profile.databaseType "postgres") (ne .Values.database.profile.tenancyMode "pooled") -}}
{{- fail "database.releaseEffectCohort requires the explicit postgres/pooled database profile" -}}
{{- end -}}
{{- if or (not .Values.database.migration.enabled) (not .Values.database.preflight.enabled) -}}
{{- fail "database.releaseEffectCohort requires owner migration and restricted preflight hooks" -}}
{{- end -}}
{{- $releaseId := required "database.releaseEffectCohort.releaseId is required" .Values.database.releaseEffectCohort.releaseId -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$" $releaseId) -}}
{{- fail "database.releaseEffectCohort.releaseId is invalid" -}}
{{- end -}}
{{- if lt (int64 .Values.database.releaseEffectCohort.cohortEpoch) 1 -}}
{{- fail "database.releaseEffectCohort.cohortEpoch must be positive" -}}
{{- end -}}
{{- if ne .Values.database.releaseEffectCohort.inventoryVersion "release-effect-inventory.enterpriseglue.io/v1" -}}
{{- fail "database.releaseEffectCohort.inventoryVersion is unsupported" -}}
{{- end -}}
{{- if not (regexMatch "^[a-f0-9]{64}$" .Values.database.releaseEffectCohort.inventorySha256) -}}
{{- fail "database.releaseEffectCohort.inventorySha256 must be an exact SHA-256" -}}
{{- end -}}
{{- range $annotation := list "enterpriseglue.io/release-effect-release-id" "enterpriseglue.io/release-effect-cohort-epoch" "enterpriseglue.io/release-effect-inventory-version" "enterpriseglue.io/release-effect-inventory-sha256" -}}
{{- if hasKey $.Values.podAnnotations $annotation -}}
{{- fail "release-effect rollout annotations cannot be overridden through podAnnotations" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "enterpriseglue-host.releaseEffectCohortAnnotations" -}}
{{- if .Values.database.releaseEffectCohort.enabled }}
enterpriseglue.io/release-effect-release-id: {{ .Values.database.releaseEffectCohort.releaseId | quote }}
enterpriseglue.io/release-effect-cohort-epoch: {{ .Values.database.releaseEffectCohort.cohortEpoch | quote }}
enterpriseglue.io/release-effect-inventory-version: {{ .Values.database.releaseEffectCohort.inventoryVersion | quote }}
enterpriseglue.io/release-effect-inventory-sha256: {{ .Values.database.releaseEffectCohort.inventorySha256 | quote }}
{{- end }}
{{- end }}

{{- define "enterpriseglue-host.releaseEffectCohortEnvironment" -}}
{{- if .Values.database.releaseEffectCohort.enabled }}
- name: EG_TENANT_PLACEMENT_RELEASE_ID
  value: {{ .Values.database.releaseEffectCohort.releaseId | quote }}
- name: EG_TENANT_RELEASE_EFFECT_COHORT_EPOCH
  value: {{ .Values.database.releaseEffectCohort.cohortEpoch | quote }}
- name: EG_RELEASE_EFFECT_EXPECTED_INVENTORY_VERSION
  value: {{ .Values.database.releaseEffectCohort.inventoryVersion | quote }}
- name: EG_RELEASE_EFFECT_EXPECTED_INVENTORY_SHA256
  value: {{ .Values.database.releaseEffectCohort.inventorySha256 | quote }}
{{- end }}
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
{{- $settings := index .root.Values.serviceAccounts (ternary "api" .component (eq .component "frontend")) -}}
automountServiceAccountToken: {{ ternary false $settings.automountServiceAccountToken (or (eq .component "frontend") (eq .component "cohort")) }}
securityContext:
  {{- include "enterpriseglue-host.podSecurityContext" .root | nindent 2 }}
{{- with .root.Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .root.Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .root.Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .root.Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{- define "enterpriseglue-host.connectionProxy" -}}
{{- if .root.Values.database.connectionProxy.enabled }}
{{- $image := required "database.connectionProxy.image is required when enabled" .root.Values.database.connectionProxy.image -}}
{{- if not (regexMatch "@sha256:[a-f0-9]{64}$" $image) -}}
{{- fail "database.connectionProxy.image must be an immutable OCI digest reference" -}}
{{- end }}
- name: database-connection-proxy
  image: {{ $image | quote }}
  imagePullPolicy: IfNotPresent
  {{- if .nativeSidecar }}
  restartPolicy: Always
  {{- end }}
  args:
    {{- toYaml .root.Values.database.connectionProxy.args | nindent 4 }}
  ports:
    - name: db-proxy
      containerPort: {{ .root.Values.database.connectionProxy.port }}
      protocol: TCP
  securityContext:
    {{- include "enterpriseglue-host.containerSecurityContext" .root | nindent 4 }}
  resources:
    {{- toYaml .root.Values.database.connectionProxy.resources | nindent 4 }}
  startupProbe:
    tcpSocket: { port: db-proxy }
    failureThreshold: 30
    periodSeconds: 2
{{- end }}
{{- end }}
