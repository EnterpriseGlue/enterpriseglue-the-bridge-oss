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
{{- if eq .Values.database.applicationSecretName .Values.database.migrationSecretName -}}
{{- fail "database.releaseEffectCohort requires distinct application and migration Secrets" -}}
{{- end -}}
{{- $cohortServiceAccount := include "enterpriseglue-host.serviceAccountName" (dict "root" . "component" "cohort") | trim -}}
{{- $migrationServiceAccount := include "enterpriseglue-host.serviceAccountName" (dict "root" . "component" "migration") | trim -}}
{{- if eq $cohortServiceAccount $migrationServiceAccount -}}
{{- fail "database.releaseEffectCohort requires distinct cohort and migration ServiceAccounts" -}}
{{- end -}}
{{- $manifest := include "enterpriseglue-host.schemaEpochManifest" . | fromJson -}}
{{- $releaseId := required "database.releaseEffectCohort.releaseId is required" .Values.database.releaseEffectCohort.releaseId -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" $releaseId) -}}
{{- fail "database.releaseEffectCohort.releaseId must be the digest of the verified signed candidate receipt" -}}
{{- end -}}
{{- if lt (int64 .Values.database.releaseEffectCohort.cohortEpoch) 1 -}}
{{- fail "database.releaseEffectCohort.cohortEpoch must be positive" -}}
{{- end -}}
{{- if ne .Values.database.releaseEffectCohort.inventoryVersion $manifest.releaseEffectInventory.version -}}
{{- fail "database.releaseEffectCohort.inventoryVersion must equal the signed release receipt" -}}
{{- end -}}
{{- if ne .Values.database.releaseEffectCohort.inventorySha256 $manifest.releaseEffectInventory.sha256 -}}
{{- fail "database.releaseEffectCohort.inventorySha256 must equal the signed release receipt" -}}
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

{{- define "enterpriseglue-host.schemaEpochManifest" -}}
{{- $manifestBytes := required "files/schema-epoch-manifest.json is required" (.Files.Get "files/schema-epoch-manifest.json") -}}
{{- $manifest := mustFromJson $manifestBytes -}}
{{- if ne $manifest.schemaVersion "enterpriseglue-schema-epoch/v1" -}}
{{- fail "unsupported schema-epoch manifest version" -}}
{{- end -}}
{{- if ne $manifest.id "postgres-explicit-context-bridge-v1" -}}
{{- fail "unsupported schema-epoch manifest identity" -}}
{{- end -}}
{{- if ne $manifest.roles.applicationStartup.mode "verify-only" -}}
{{- fail "compatibility bridge application startup must be verify-only" -}}
{{- end -}}
{{- if ne $manifest.roles.preflight.mode "verify-runtime-grant" -}}
{{- fail "compatibility bridge preflight must verify the runtime grant" -}}
{{- end -}}
{{- if ne $manifest.roles.ownerMigration.mode "apply-through-executable" -}}
{{- fail "compatibility bridge owner migration must use bounded apply" -}}
{{- end -}}
{{- if ne $manifest.roles.ownerMigration.from.postgresPolicyProfile "legacy-tenant-context/v1" -}}
{{- fail "compatibility bridge owner source must use the exact legacy tenant-context policy" -}}
{{- end -}}
{{- if ne $manifest.upgradeContract.minimumDatabaseEpoch.postgresPolicyProfile "legacy-tenant-context/v1" -}}
{{- fail "compatibility bridge minimum epoch must use the exact legacy tenant-context policy" -}}
{{- end -}}
{{- if ne (int $manifest.roles.ownerMigration.through) (int $manifest.executableMigrationInventory.through) -}}
{{- fail "compatibility bridge owner migration ceiling must equal the executable inventory" -}}
{{- end -}}
{{- if ne (len $manifest.acceptedDatabaseEpochs) 2 -}}
{{- fail "compatibility bridge must declare exactly two accepted database epochs" -}}
{{- end -}}
{{- $preEpoch := index $manifest.acceptedDatabaseEpochs 0 -}}
{{- $postEpoch := index $manifest.acceptedDatabaseEpochs 1 -}}
{{- if or (ne $preEpoch.id "pre-enforcement") (ne $preEpoch.postgresPolicyProfile "dual-context-compatibility/v1") (ne (int $preEpoch.through) 1700000000131) -}}
{{- fail "compatibility bridge pre-enforcement epoch must use the exact dual-context policy" -}}
{{- end -}}
{{- if or (ne $postEpoch.id "post-enforcement") (ne $postEpoch.postgresPolicyProfile "explicit-context/v1") (ne (int $postEpoch.through) 1700000000132) -}}
{{- fail "compatibility bridge post-enforcement epoch must use the exact explicit-context policy" -}}
{{- end -}}
{{- if ne $manifest.executableImplementationInventory.purpose "owner-transition-1700000000131-dual-context-closure/v1" -}}
{{- fail "compatibility bridge implementation purpose is unsupported" -}}
{{- end -}}
{{- if ne $manifest.releaseEffectInventory.version "release-effect-inventory.enterpriseglue.io/v1" -}}
{{- fail "compatibility bridge release-effect inventory version is unsupported" -}}
{{- end -}}
{{- if not (regexMatch "^[a-f0-9]{64}$" $manifest.releaseEffectInventory.sha256) -}}
{{- fail "compatibility bridge release-effect inventory must be an exact SHA-256" -}}
{{- end -}}
{{- toJson $manifest -}}
{{- end }}

{{- define "enterpriseglue-host.schemaEpochTarget" -}}
{{- $databaseType := .Values.database.profile.databaseType | default "" -}}
{{- $tenancyMode := .Values.database.profile.tenancyMode | default "" -}}
{{- if ne (empty $databaseType) (empty $tenancyMode) -}}
{{- fail "database.profile.databaseType and database.profile.tenancyMode must be set together" -}}
{{- end -}}
{{- if and (eq $databaseType "postgres") (eq $tenancyMode "pooled") -}}true{{- else -}}false{{- end -}}
{{- end }}

{{- define "enterpriseglue-host.schemaEpochStartupMode" -}}
{{- if eq (include "enterpriseglue-host.schemaEpochTarget" . | trim) "true" -}}
{{- include "enterpriseglue-host.schemaEpochManifest" . | fromJson | dig "roles" "applicationStartup" "mode" "" | trimSuffix "-only" -}}
{{- else -}}
{{- ternary "verify" "apply" .Values.database.migration.enabled -}}
{{- end -}}
{{- end }}

{{- define "enterpriseglue-host.schemaEpochOwnerMode" -}}
{{- if eq (include "enterpriseglue-host.schemaEpochTarget" . | trim) "true" -}}
{{- $applicationSecret := required "database.applicationSecretName is required for the pooled PostgreSQL schema-epoch bridge" .Values.database.applicationSecretName -}}
{{- $migrationSecret := required "database.migrationSecretName is required for the pooled PostgreSQL schema-epoch bridge" .Values.database.migrationSecretName -}}
{{- $preflightSecret := required "database.preflightSecretName is required for pooled PostgreSQL schema-epoch preflight" .Values.database.preflightSecretName -}}
{{- $runtimeRole := required "database.migration.runtimeRole is required for pooled PostgreSQL schema-epoch preflight" .Values.database.migration.runtimeRole -}}
{{- if or (eq $applicationSecret $migrationSecret) (eq $applicationSecret $preflightSecret) (eq $migrationSecret $preflightSecret) -}}
{{- fail "pooled PostgreSQL schema-epoch bridge requires pairwise-distinct application, migration, and preflight Secrets" -}}
{{- end -}}
{{- $migrationServiceAccount := include "enterpriseglue-host.serviceAccountName" (dict "root" . "component" "migration") | trim -}}
{{- $preflightServiceAccount := include "enterpriseglue-host.serviceAccountName" (dict "root" . "component" "preflight") | trim -}}
{{- if eq $migrationServiceAccount $preflightServiceAccount -}}
{{- fail "pooled PostgreSQL schema-epoch bridge requires distinct migration and preflight ServiceAccounts" -}}
{{- end -}}
{{- if .Values.database.releaseEffectCohort.enabled -}}
{{- $cohortServiceAccount := include "enterpriseglue-host.serviceAccountName" (dict "root" . "component" "cohort") | trim -}}
{{- if or (eq $cohortServiceAccount $migrationServiceAccount) (eq $cohortServiceAccount $preflightServiceAccount) -}}
{{- fail "pooled PostgreSQL schema-epoch bridge requires pairwise-distinct migration, preflight, and cohort ServiceAccounts" -}}
{{- end -}}
{{- end -}}
{{- include "enterpriseglue-host.schemaEpochManifest" . | fromJson | dig "roles" "ownerMigration" "mode" "" -}}
{{- else -}}
{{- ternary "legacy-apply" "disabled" .Values.database.migration.enabled -}}
{{- end -}}
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
