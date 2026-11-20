# Changelog

All notable changes to this project will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/) and uses [Release Please](https://github.com/googleapis/release-please) to manage release notes.

## [0.40.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.6...v0.40.6) (2026-11-20)


### ⚠ BREAKING CHANGES

* **security:** unify browser XSRF token transport
* **release:** prepare complete batch documentation without repeated package bumps
* **deps:** separate optional server peers from browser installations

### Features

* **auth:** add account-only protected documentation access ([284af26](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/284af26e40ec227a31fbab049ce0405dc98881ef))
* **auth:** add account-only protected documentation access ([fd0f8ca](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fd0f8cabf484c0884462b503dc3c2ef986f407f4))
* **auth:** add Cloud email and passkey signup ([3c57a83](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3c57a83ae28dcd1c3ad69186da434da091124a40))
* **auth:** add organization selection and account switching ([51b957d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51b957d6904233ddc89d93f7c851c6d4891ff1d7))
* **auth:** add organization selection and account switching ([c0d12eb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c0d12eb87b7646cb54a26f6c918f7d624a96cd20))
* **auth:** add verified documentation subscriber handoff ([94ed6ba](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/94ed6badb7653ad0c2623eff9ea5a7f7398b8807))
* **auth:** bind Cloud passkey schema owner and runtime grants ([303a5db](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/303a5dbda10cecd44a2c05f7847105a9d6878912))
* **auth:** enforce company sign-in with verified administrator recovery ([ecaa591](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ecaa59174fbc6a925f79e71271dc01e31ad6244b))
* **auth:** require verified MFA for managed platform administrators ([13d786d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/13d786dc3c818a939f0f529ff94fe318bb953aec))
* **auth:** support Microsoft Cloud account sign-in ([a015c7a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a015c7a46fa6f37e698f02335bd7b2c50fc9f8ad))
* **auth:** verify new Microsoft Cloud account email addresses ([3dc4151](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3dc4151a9e6cf753662d355fcd181473d631869f))
* **cloud:** attest organization requesters and send request updates ([af38853](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/af388539dabdfcc27949124a579145daceacd3b7))
* **cloud:** verify organization request identity and send notifications ([b80af23](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b80af236aff376b726982201487562211bc7d20b))
* **config-bundles:** apply bundle directories at startup and live ([14e9688](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/14e96888bb7a78bafaede8577d7be7eebb470e11))
* **config-bundles:** apply bundle directories at startup and live ([c03fb42](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c03fb42bd8ec50f403ddaa231c3ee17b7673239b))
* **docs:** add customer-specific workspace admission ([42c4444](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/42c44446dc26ed052fa0aa9bd7066fcc33efb1f6))
* **docs:** add customer-specific workspace admission ([9404512](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/94045125b4f14cb0cee871073b5342da891ac991))
* **docs:** add shared account profiles and independent release drafting ([777fbe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/777fbe019561ff3366e6ab178f7e98b3d6fe8295))
* **docs:** add shared account profiles and independent release drafting ([f568f87](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f568f87071c89283ddd74acc356cf52dcdae9041))
* **docs:** share a verified account email with the documentation gateway ([3076ae1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3076ae13a49a3d1129a69d39b46919d67022d2fa))
* **frontend:** support TLS for the backend upstream ([517e7ef](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/517e7ef850cdea4067c80d9f7eaa0a556af0b5c8))
* **frontend:** support TLS for the backend upstream ([0203715](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0203715ea0287ef9850cfa4bbc190ecb47c78287))
* **host-dashboard:** guide new workspaces through setup ([e4ea916](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e4ea9167148456fddacc41a6d0ecdfffd8bea562))
* **host:** expose first-run workspace actions through a dashboard slot ([2bd924a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2bd924a3e2fd22c8c4c312d34fa4c938adba06c3))
* **identity:** add tenant-scoped SSO proxy connections ([367b1d8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/367b1d860cb4d5f464a13f60a55ac513d3ce9067))
* **identity:** add tenant-scoped SSO proxy connections ([e87eccb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e87eccb86465ed7b458a81201cbcdea63a6d6123))
* **logging:** add configurable structured runtime logs ([c48fc52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c48fc52e492c88812ccd4999baed07b5b287928b))
* **logging:** add configurable structured runtime logs ([5290601](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/52906013824f32600bb9dec15f311f1a787808fa))
* **oracle:** add optional required AES256 native network encryption ([f524bc7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f524bc7ee25defca9ed36bfea6f2ddd4f8b544c5))
* **oracle:** add optional required AES256 native network encryption ([e6ef51a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e6ef51a85fa094698908638c55ad533ad6371174))
* **oracle:** finalize release qualification and rollback documentation ([d325f60](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d325f6031aa1df1675f6081bf927ab9a7f5098bf))
* **oracle:** finalize release qualification and rollback documentation ([fda3c6f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fda3c6fb1028530c3c8c92b6b5ab9c66a49bf69f))
* **schema:** recognize signed Cloud passkey epoch for rollback ([6151f83](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6151f830e97a68c2387199115bd0904f403d5148))
* **security:** unify browser XSRF token transport ([8b5e424](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8b5e424d0b4711ea1f52feab294ef8dac19d4d50))


### Bug Fixes

* **admin:** bind directory views to canonical access contracts ([e5ecf2e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e5ecf2efc7e7a6f5a6daf72ebc1d3be709eabae2))
* **admin:** enforce audited lifecycle and profile ownership boundaries ([c3b3317](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c3b331705e52e29e800a5155fb63114a721b768a))
* **auth:** align email signup choice and explain passkeys ([923d6bc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/923d6bcccc1726c534284d430a9d42f644e0f567))
* **auth:** align email signup choice and explain passkeys ([538188d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/538188dd7449fc27b5004b63bf8c120fcb833860))
* **auth:** align organization chooser with pooled login ([23d1fe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/23d1fe0b5929078ad37a7fb4fed87825a6689a40))
* **auth:** apply Microsoft mailbox proof to normalized issuers ([9051a74](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9051a74851e11a6ffe4fe05a1bc6fe5fa953ab31))
* **auth:** bound bootstrap refresh to its original session ([af07bae](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/af07bae167104c8e81b38d8ee1abab1f3f538747))
* **auth:** clarify personal email discovery on landing ([e3e7065](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e3e7065f6791abcbe9215902fb6c06a4428ef2ab))
* **auth:** enforce configured company sign-in on tenant sessions ([87a3d66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/87a3d667d4ed4fac4895554af0eb7c27f709ce32))
* **authentication:** link global SaaS OIDC providers ([51f16ed](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51f16edb847e69901a5875bc3bd90cbf477ccefe))
* **authentication:** link global SaaS OIDC providers ([97b6c91](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/97b6c9127d7e042d6999cf5048a80c51e390dc51))
* **auth:** fence browser continuations across session changes ([67023d4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/67023d46b661002bd4e3156d846f28d42f4a2466))
* **auth:** find organizations after cloud account sign-in ([579b0ad](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/579b0ad29242f2357832794ebe9db779df60bd37))
* **auth:** find organizations after cloud account sign-in ([129d8ec](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/129d8ecbc49edd9c2d6918605844ec0cddc2d924))
* **auth:** keep Cloud passkey sign-in reachable on login ([04c101f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/04c101faf54390836867b2f04c764f0a8005b0d2))
* authorize and bind editor runtime navigation ([7d8a3e8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7d8a3e8040f1dcc99c34db1b1ec92cf4abdbec94))
* **auth:** parse browser cookies without dynamic property writes ([22157be](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/22157be824b11c43d8a9970d171a5039c298e53f))
* **auth:** qualify owned passkey fixture and patched WebAuthn runtime ([e7fc67e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e7fc67e3604367c3a9f2b7cb1b102fd553ce0f08))
* **auth:** separate Cloud signup from account discovery ([1924c52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1924c523d4c30c16c90172b755c708b353ba69eb))
* **auth:** share browser protections with the database fixture ([f15e1c1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f15e1c15cf495ee47d63e0383b9cabb77514b246))
* **auth:** stage signed passkey schema transition and CI repair ([9b09ad8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9b09ad88347d1cce055175687aec093c8f66bdc3))
* **auth:** support protected Cloud email-link sign-in ([2b4a6a0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2b4a6a044efa8497166dadcfdaf5c949db3d01f4))
* **auth:** support protected Cloud email-link sign-in ([6a99780](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6a99780b3b643eaca590e19ff60d302a98b4a01a))
* **auth:** unify public authentication appearance ([7a890ad](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7a890ad30c7a72815ccfdfa53ae89016768ff0ea))
* **auth:** unify public authentication appearance ([cf8e6ba](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cf8e6ba8b3f36ad5d4ad2214cac9ab2d3441a6c4))
* **auth:** verify CSRF for email proof completion ([a0bd8f0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a0bd8f0eaf00927266554c63c2018dddf2b722cc))
* **authz:** register runtime instance tenant read aliases ([8c9df01](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8c9df01277f48c33ce7292279fd1a87c4292cbf8))
* bind deployment deletion to current authority and exact acknowledgements ([002acf1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/002acf198cf4aff57951ef8a50302a284b1b673d))
* bind editor handoffs to deployed selection and session ([8a0ef81](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8a0ef810d0b82e95db62a870403bd0d4369467dd))
* bind migration reviews to canonical owned payloads ([6ad38ff](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6ad38ff8da23769a3db5ccb1a8fdb5faaa622349))
* bind process starts to exact definitions and current session ([7624f63](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7624f638b5ca8cb3d0478dbb7872163134101daf))
* bind project creation and Git connections to reviewed context ([0183b68](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0183b688af006cdbc82baa6b69d72d76b9705137))
* bind project imports to context and atomic version creation ([34fa11e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34fa11e13694ec7f316c79a3aa2a33a87e3f3216))
* bind runtime bridge navigation to its source selection ([bfeaf30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bfeaf305f7073afb88e7372eb8be1baa12a58a96))
* bind single-file restore persistence and UI acknowledgements ([ca33b29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ca33b29201585d0cce7f3790bc912ea184dcc583))
* **bootstrap:** make strict Git provider seed timestamps deterministic ([ea0c6f1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea0c6f1ccb9b2bca73c91292e1a3d138454c5313))
* **ci:** bound font-verified browser evidence and preserve cleanup failures ([3ce3647](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3ce3647c780bd292a3870845b1df945f95cc0c55))
* **ci:** let Oracle smoke own pristine migration bootstrap ([1755c2e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1755c2ed5c70bb028ac6d5dbf88083da651d914a))
* **ci:** pin verified Trivy release downloads ([b3dd98d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b3dd98d9233eedd70bef1e4584bb1973c94100bf))
* **ci:** verify rendered fonts before bounded browser evidence capture ([2307d1e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2307d1e762ba96555d32022ae6cf5568d2a4d7de))
* complete tenant-bound deployment and runtime workflows ([bff2dd0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bff2dd0ca0e48f026b642e16786b3502773fcfdf))
* complete variable write and process action wiring ([9079cd8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9079cd8d7f5c727d28297c155a2568db17b7543f))
* **config-bundle:** let the pooled signup bootstrap disable a managed provider ([21771d8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/21771d886ef933a0bd773dca17cc880ba3e66373))
* **config-bundle:** let the pooled signup bootstrap disable a managed provider ([8ea28b5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8ea28b5510cb9c832dc295aead8ff8126640b69c))
* **config:** honor bootstrap authority in verify mode ([2cf705d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2cf705df63e1033cccd62771156fb91650e0a43b))
* **config:** honor bootstrap authority in verify mode ([df393de](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/df393ded6af6b825a9f10b433462b72ee2e0a013))
* **config:** reject runtime configuration redirects ([071bc46](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/071bc46db06cbc5dbbf58857f2f3077176cf0d43))
* **dashboard:** align filters without an engine ([1f03951](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1f03951bbbe69407289bb0afa782d6d2c18fd585))
* **dashboard:** align filters without an engine ([f3a990c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f3a990ca3203fd944c1931195a2d0fca29ca64f6))
* **dashboard:** keep project count request alive after sign-in ([fbb341a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fbb341a7d666ba9196d4505cf9e5c5e25b58960f))
* **dashboard:** start project totals earlier on workspace reload ([f54ca61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f54ca61a6b8722a2bbae1fd5851b56cb0fbf1365))
* **dashboard:** start project totals earlier on workspace reload ([eb87935](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eb87935504b603d87169606c8c978829887b192b))
* **db:** exclude migration helpers across all compiled adapters ([d92b370](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d92b37094207001129c130cc23f8941b3b94bc7d))
* **deployment:** scope release verification claims ([af4170d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/af4170d2d6f3430e9c34b04dded3a7623215898a))
* **deployment:** scope release verification claims ([77ebe0b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/77ebe0b58674d13a8e9584a41dad4005dd749c53))
* **deploy:** remove legacy Git filesystem storage ([2f714f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2f714f9683d95fbe345786dd04b5b58098bd7c14))
* **deploy:** remove legacy Git filesystem storage ([8aee265](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8aee265c7717f9962e69fdf659b42a227e18681b))
* **deploy:** wire Cloud email protection through the host chart ([02f36e1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/02f36e18a7221fa8125ed21e22ec98357b949778))
* **deps:** include security patches in developer image installs ([122ad52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/122ad525d4e6be3978ff4eb565ce145c4e212a4a))
* **deps:** patch qs serialization denial of service ([612f80a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/612f80a28e29b154ad6dd017bc784de2eafded31))
* **deps:** patch qs serialization denial of service ([848db70](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/848db706d47074831a7a6c716aa335f710af63cd))
* **deps:** prepare approved security floors pending qualification ([88c0a41](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/88c0a413bb7521dc1bcd5427b62626419756014d))
* **deps:** qualify bounded SQL diagnostics and refreshed production dependencies ([d67e69d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d67e69d10cd5d2c55809b55c80433dcfba796d8f))
* **deps:** repair production image security qualification ([705f1db](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/705f1db257fc3124661f069eff32f09aa7397a8f))
* **deps:** resolve optional server peers in production assemblies ([7f206e2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7f206e26e34d3c9feb7b65ac255aa3961db3ceec))
* **deps:** separate optional server peers from browser installations ([68e518c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/68e518ce77f559068d8b68102d3a10a201422e51))
* **dev:** align Linux Compose ownership with checkout user ([1cb823c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1cb823c7a959f90a110bd8e13d2a4ca30784e49f))
* **dev:** make Compose first startup reliable ([e4cd657](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e4cd657d0a92f2c05f43a9ef439b0e8bd85c3019))
* **dev:** make Compose first startup reliable ([72a16cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/72a16cf047707d5eabc3bac24fb8ab11112a5871))
* **dev:** make fresh Linux Compose startup writable and test it in CI ([6f66ab8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6f66ab846878d7a1f54a9a7e23f31a0e3cdbe999))
* **dev:** verify documented fresh-clone teardown ([574e476](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/574e47685297d662417dd38bbcfb97a841dce4ea))
* **dev:** verify documented fresh-clone teardown ([256d774](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/256d7749d5509e8963c6ff2cc0f047d0175c191b))
* **docs:** expose corrected domain admission contract ([39c6eef](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/39c6eef2a9d34f3fe7cef71c3149c713ddfc45bf))
* **docs:** require central domain authority for automatic admission ([9a15d3a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9a15d3aecb670108196c9965c41d6f12966f988c))
* **docs:** require central domain authority for automatic admission ([27133a4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/27133a4e5226634e37ee6d3fc228cf6f4baf65d7))
* enforce patched Brotli runtime package floors ([e170ec2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e170ec29012b6299e8dd8ea6aa5d058c9b81d674))
* **engines:** accept workload-managed inventory ownership ([eb40e28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eb40e28e684e3bfc6adaa5e2369248f2577b92ee))
* **engines:** accept workload-managed inventory ownership ([7c1fdcd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7c1fdcd64cf41ebb3fdbd3484b141e1cbcaf5a0c))
* **frontend:** add space below the organization picker header ([7890c44](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7890c4419d9f56c4066b27da6442f01fb15272d1))
* **frontend:** add space below the organization picker header ([728c99f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/728c99ff64fdcfcf57717ca9ad02efce4193422c))
* **frontend:** align organization sign-in to the Carbon grid ([bf26412](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bf264124decd1258a0868407c7023b512e1cc778))
* **frontend:** align organization sign-in to the Carbon grid ([48a71da](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/48a71dae141ca1652268d20e974bf8329cc40e53))
* **frontend:** keep organization switches stable across tabs ([e07f39b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e07f39b5b76a883770f4778b2d2ce0253190c631))
* **frontend:** keep organization switches stable across tabs ([f4525bc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f4525bc0d61686ba683d27ad8de2b72a3098955a))
* **frontend:** load workspace dashboards progressively ([e9fb35a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e9fb35a06d4d9e49464da49f6bbfaaa492585aa4))
* **frontend:** load workspace dashboards progressively ([eb49375](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eb49375d1db24847b7601b56c07550181383e750))
* **frontend:** preserve navigation in access-control editors ([49643b8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/49643b8d0df99d91e1747d6fb4539a59c913eb31))
* **frontend:** preserve navigation in access-control editors ([e2ab688](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e2ab6881cce950cf05802b12140ea2c123996ccf))
* **frontend:** revalidate app entry and open verified workspaces ([22d0307](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/22d03070e981c7580c1043e40c95039f8070bc2b))
* **frontend:** revalidate app entry and open verified workspaces ([cecec13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cecec135df210058c09e11f63106a234a1d3ca8e))
* **git:** bind deployment exports to reviewed saved revisions ([347ff21](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/347ff2142a16c20b8822b3bc28a589f9ed438bce))
* **git:** bind project connection settings to current context ([84be0b1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/84be0b19502c774c7dbe83632c59ce0733899cd9))
* **git:** fence manual sync acknowledgements and bulk queues ([fb19fe6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fb19fe67b11b96f24d1e8f5fc67c5172b162bd36))
* **git:** seed GitHub for new managed cloud tenants ([298e970](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/298e9707300fc7be8ee0cadb21c91bb1831b5c14))
* **git:** seed GitHub for new managed cloud tenants ([acb52b0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/acb52b0559c502e92879ada8658091a567067895))
* **git:** show token guidance only for the provider in use ([9a9124b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9a9124b4417d3615e6941f8e476fccf0d2080155))
* **git:** show token guidance only for the provider in use ([73c38cb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/73c38cb40bc968bfefaf0934c1f395151c53ff8b))
* **git:** verify personal credentials and owned OAuth completion ([b1d1ad5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b1d1ad51c45571d747f9d414ce1045e223fe2919))
* **identity:** honor explicit organization-read grants for cloud accounts ([9f00278](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9f00278f42a6da7012099e11f0713fb064f072ef))
* **identity:** honor explicit organization-read grants for cloud accounts ([ab85dbb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab85dbbfa74b851494326df77c7893690c8c9982))
* implement Oracle migration portability to all migrations ([bb36ef9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bb36ef93707c1445a030372404be747b92743266))
* implement Oracle migration portability to all migrations ([e9b7513](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e9b7513347e1468265c278401b27cd5bc2edceb2))
* **installation:** preserve compiled migration identity and macOS shutdown ([24f7c8e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/24f7c8e87b1e7c3ec8fe7e50f36db0bd9a4a583d))
* **installation:** qualify supported Node and patched runtime OS floors ([964d098](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/964d098c1dffc10c19f4da9249eedf36f3651a05))
* **installation:** restore compiled upgrades and qualified runtime ([a5a67e9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a5a67e9fd3476c29c066d27baba37f35d16fd335))
* **login:** tell a returning user to use the method they signed up with ([5166766](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5166766a24e05a54485dfd9fa61746a49d2eba5b))
* **login:** tell a returning user to use the method they signed up with ([a6c764b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a6c764b2da29ebb0175c515244f7682f37846d81))
* **mission-control:** filter BPMN badges by process start time ([0ef8e0c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0ef8e0cff92d72a63b4e477c58abbd81548dd5fb))
* **mission-control:** filter BPMN badges by process start time ([ae63b13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ae63b1325a2dca3dd7dee6b3df2b652d09d7999e))
* **mission-control:** handle opaque instance definitions and missing variables ([4300983](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4300983eb7caa255a41431f9552b1c141418b045))
* **mission-control:** handle opaque instance definitions and missing variables ([0b0d532](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0b0d532ef7348f7d9a0bb09183d65486c5b10d58))
* **mission-control:** hide tenancy controls for managed engines ([7c2de69](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7c2de69f554815cca7c248b5aad01caafab54bad))
* **mission-control:** hide tenancy controls for managed engines ([bd57156](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bd57156e2b07dd64fefc152790c732d66f2008fe))
* **mission-control:** preserve historic process lookup errors ([c36963e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c36963ed804ccb6b3d62b03555d31dae7219571c))
* **mission-control:** preserve historic process lookup errors ([55b342d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/55b342d56b36a25104413bc26e6e7cad0878f50a))
* **mission-control:** preserve missing runtime process responses ([ba1df48](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ba1df48a8a9ba748f1a7815d79b1748b90db43d7))
* **mission-control:** return not found for missing runtime instances ([93fb7a6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/93fb7a60ae5895367e8ba437e455d6d128dd0ae3))
* **mission-control:** show full friendly engine names in the engine picker ([3da0f79](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3da0f7915fc75df14a0b2b30c4f3c4e0275aec56))
* **mission-control:** show full friendly engine names in the engine picker ([40d03cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/40d03cf7f1e6989a1d6a2be27f6eceeda1d4e38f))
* **oracle:** close configuration races and verify publication authority ([a6dbc10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a6dbc10fd7154108f2a4777a9c335114a1357e90))
* **oracle:** enhance migration portability for Oracle ([6350a40](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6350a40906ca507af770e350ad69df22559e4136))
* **oracle:** make native acceptance fixtures portable on Linux ([c14f4d4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c14f4d4512e4ec6be2cb377ac7188c58860b64fb))
* **oracle:** preserve migration data and finish interrupted widening ([5326089](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/53260899405e3f24ece2221eb7f99092e860a6b9))
* **oracle:** support historical boolean migrations on pre-23 databases ([6a2bb64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6a2bb64d230e32ed61aa6a997365aaec123fcc5a))
* **oracle:** support historical boolean migrations on pre-23 databases ([c3d155f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c3d155f4ca1ad68ede89f916a9d0ccd9aad2671e))
* patch acquisition toolchain Node 24 runtime ([0cc3ebb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0cc3ebbd3851c82521c97d4e4625bccee36c3720))
* patch browser sanitization and test toolchain advisories ([635038e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/635038e6b168a70dd7c7c07cfd61307440ddc07b))
* **plugins:** document frontend bootstrap and require OpenAPI parity ([107a849](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/107a849c1beae6ea169a027f5d11469c67ed0280))
* **plugins:** document frontend bootstrap and require OpenAPI parity ([2174329](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2174329efa57e60d8cc01c77b7641e38f736a624))
* preserve data when migrations change nullability on Oracle ([ea2ee05](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea2ee05bfd4bc37d7905528886034615577b0135))
* preserve pooled startup and patch acquisition tools ([41b9044](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/41b904405fa1f5c7af73833ad911b107ea13fe1d))
* refresh vulnerable runtime dependencies for v0.35.1 ([4ce3c85](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4ce3c8597de2ed2560b745f491364a346574fd34))
* **release:** add read-only pre-merge authorization canary ([1b1a318](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1b1a318404ba50fbcc6eb066dda0b2fcb112c7b3))
* **release:** align Cloud email host package versions ([eae21d5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eae21d5481f15a5149726fa9c6eacad5d7b6fab6))
* **release:** enforce reserved versions in manifest preparation ([de15fce](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/de15fce0f1904dac1a4491f25b11f1dfa9134cd0))
* **release:** enforce reserved versions in manifest preparation ([8bba237](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8bba237fb39cd6db736ebcdefaf532571cf7abfe))
* **release:** keep the plugin API on its compatible line ([cc7b8b2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cc7b8b2f17ab123f3e13bcb0fddcfcc02e76ae20))
* **release:** make frozen batch publication resumable ([099a597](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/099a5971ce116e0cef6e5488beb37306311dd2ea))
* **release:** make frozen batch publication resumable ([2e95d8f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2e95d8fecd5c34b791683af24fc4c6955dcb71e9))
* **release:** make frozen batch publication resumable ([9f27cb9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9f27cb9b5cabfa01a7624dd9db358499c2415222))
* **release:** make frozen batch publication resumable ([18e13dc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/18e13dcd573b2e776ecee16c5a54dff80c9243a8))
* **release:** make frozen batch publication resumable ([f99a3be](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f99a3be3b52df715f38c47ae9a79c99c1f896c72))
* **release:** make frozen batch publication resumable ([714fa10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/714fa1029db8ce694221b9859ff0610391ae1f8f))
* **release:** prepare complete batch documentation without repeated package bumps ([81d3f20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/81d3f2090aaa0b2e0e93e71ff65aad98517e782e))
* **release:** preserve frozen distribution receipt during recovery ([c6a9650](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c6a96500b71e01dce17431d3fa306408fba26124))
* **release:** preserve frozen distribution receipt during recovery ([73acac2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/73acac222e45c06436cb466c0773e1325181b159))
* **release:** recover authenticated unsigned publication identity ([e98da17](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e98da172cf2e80794df1fbfaa521a797909a75bb))
* **release:** recover authenticated unsigned publication identity ([015557e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/015557ef5828ddc1840d9c8da6476a5f8ff7f27d))
* **release:** repair source-bound publication handoff and evidence retention ([e595e20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e595e2098d8572ffab07bbe84016a4249d517977))
* **release:** repair source-bound publication handoff and evidence retention ([3e74554](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3e74554ab2ed937666fdd66bb1ab156a08bf5619))
* **release:** require explicit complete-batch publication approval ([d6c2cb9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d6c2cb9d5be1b1b74c524119693b219d7b38815c))
* **release:** require explicit complete-batch publication approval ([74435cd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/74435cd0c3d726c3a32d8996d0f0790cd7896005))
* **release:** retain Oracle receipts and documentation catch-up inputs ([83e27ab](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/83e27abbf76c09614a0ae89d424edf995ad0b590))
* **release:** retain Oracle receipts and documentation catch-up inputs ([dfd1112](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/dfd11127faa3cc853a0c1dccf1f5eaa4a22f1e47))
* **release:** stop recovery over partial attachment sets ([8903f57](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8903f577d5d019f7c21fb6cc7878a3905b62c20f))
* require current Node security patches in host and bootstrap ([f43603a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f43603a119c0d95d0fbb63cfe07c0acba167b5ac))
* resolve runtime definition links atomically ([9f8ed88](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9f8ed8835269c782461c9b7e2dcf6eda0f99eec5))
* restore deployment options and JSON variable editing ([7b97e66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7b97e6658b4a2522d2e2fef2b07cbe660e59a296))
* restore deployment options, JSON variables and secure matching ([fe1440b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fe1440b198484e046c26e1fa91723ddd5049bcab))
* **schema:** recognize signed Cloud passkey epoch for rollback ([02f20c1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/02f20c1c9f2496c019600620a6e7903ebef75a15))
* **security:** encode snapshot identifiers and complete browser fixtures ([59576e6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/59576e6fc4697b4c1114ef99aa1b427b0b185c2b))
* **security:** normalize trailing URL slashes in linear time ([b75e4e3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b75e4e300048259ce52ecac40b9f4672c5fd7ad7))
* **security:** normalize trailing URL slashes in linear time ([a229314](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a229314ffa2c0b15baf3deba63cc4d0cbfeaa292))
* **security:** patch bundled OCI tools and compiled SSO runtime ([047df4e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/047df4ed7cbed43310d123c904f8ad4311bd13dd))
* **security:** patch Cosign JWK parser in acquisition tools ([2be1546](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2be15463f6b4b89bff61a1fc1a1064c875116261))
* **security:** patch embedded HTTP2 toolchain modules ([a39b1d3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a39b1d32e37feee466f15f15582482f3624b0d53))
* **security:** patch embedded HTTP2 toolchain modules ([59ad7c5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/59ad7c556b44028c87a08063d84deffba99b4656))
* **security:** patch plugin toolchain compression dependency ([2f292ed](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2f292eda618454f8e4df79af63b5fd197f2286fe))
* **security:** patch runtime certificate and curl dependencies ([c2141af](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c2141af1d8c8022cf76d862b6eba45663696eeab))
* **security:** patch runtime certificates and plugin toolchain dependencies ([0ba380b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0ba380b4a650cee4aeca1df6afbe0db5bf5b2b7c))
* **security:** pin fixed Expat in production runtime images ([b6ef7a4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b6ef7a4d45ec176f53ac7a09eaa10849e0590aff))
* **security:** pin fixed Expat in production runtime images ([0d16205](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0d16205d8961e44569149650dc5fcbdf81bcc63a))
* **security:** qualify additive peers and literal alias substitution ([56446f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/56446f9e89fd8283bc8f8ef593e01c22d248b01b))
* **security:** qualify patched glob and minimatch runtime dependencies ([654448b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/654448b3cb2a5cb0883f28c21b637c0e156523d6))
* **security:** raise ip-address parser security floor ([b953add](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b953add6c7a7f17d71f62df507be982b6f780242))
* **security:** raise the Wolfi glibc runtime floor ([e567c45](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e567c453126f4503fa6c5abdd9117319b7fd1249))
* **security:** raise the Wolfi glibc runtime floor ([70b3f73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/70b3f735833d309c582400af9e88c3308c283b13))
* **security:** rebuild OCI toolchain with patched Go ([9d591a6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9d591a6896c9ae8c8ce6007f15710e821e5eea2d))
* **security:** rebuild OCI toolchain with patched Go ([6f13bf5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6f13bf549a7df22076ea8f974e6e6e46640ee461))
* **security:** refresh application runtime bases before SSO delivery ([15d6426](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/15d6426147d98112b48982a7750226ca47e43c05))
* **security:** refresh runtime dependencies for v0.35.1 ([183a589](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/183a5895cd71855be497e785c4ee40fcfc62e893))
* **security:** refresh zlib in frontend and bootstrap runtimes ([1d2b79c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1d2b79ca3b5e323adb5f89e539584c17fcda6384))
* **security:** remove deepmerge and patch Cosign JWK parsing ([b58f515](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b58f51505a2e8b6cc449275959c52287baeb1da4))
* **security:** remove node-gyp from runtime images ([f87ed41](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f87ed41d2888c9d8150a7635f5092ccb86981943))
* **security:** remove node-gyp from runtime images ([975a5d6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/975a5d621f0732f0c2ef1f3a8acd48fea2aec399))
* **security:** remove resolved scanner exceptions ([7457312](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/745731244ff7daba13a5cf1848d820d3eff0afe0))
* **security:** remove vulnerable backend dependencies ([14b8315](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/14b8315a6c68db8d680fbed0941fd5f7681bc03f))
* **security:** remove vulnerable backend dependencies ([1ea2c1e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1ea2c1e2ce0fb4fcc1b8adc8565f256d070dc2cf))
* **security:** remove vulnerable Bitbucket SDK dependency ([7e5ce5a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7e5ce5aef5e5e8c490b12cd5e73be1245bc4c94b))
* **security:** update backend runtime to Node.js 24.22.3 ([ce6a54f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ce6a54f15274c1d4a36ba277a1e54fd8500c93bc))
* **security:** update backend runtime to Node.js 24.22.3 ([c8bbf3c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c8bbf3c8a58fbc8dd49336ef2c00f0337ea38e48))
* **security:** update Go networking in plugin acquisition images ([bc47eef](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bc47eef0d386a6aae38c8ea35e2f0c7f26010321))
* **security:** update Go networking in plugin acquisition images ([aa492c8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aa492c821337b3205d9d27ae155d2e80059c2e66))
* **security:** update managed-shard bootstrap runtime to Node.js 26.13.1 ([1083a28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1083a28f7f14d3400efaf432445ae705ea931bb9))
* **security:** update managed-shard bootstrap runtime to Node.js 26.13.1 ([e401b64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e401b642b680fe05a988dc6197e92c151be0112c))
* **security:** use vendor-patched zlib without expired exception ([bf3225b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bf3225b8a698695f71e5b0df16a9fb992bec3cd5))
* **security:** use vendor-patched zlib without expired exception ([2d2c782](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2d2c78273efa00683f9257d7345f07142937b44c))
* **sso:** support split frontend and API origins ([623f3c1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/623f3c1935b7f4a9c19ee439d5dcaedff7a8fe0f))
* **sso:** support split frontend and API origins ([6acc452](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6acc4525aecc74c23fb00f6cb21b9cdbe4e31255))
* **starbase:** bind folder actions and traversal to projects ([4a67576](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4a67576c70d84bfbb760377097ef9ce36ca05f56))
* **tenancy:** preserve platform administrator ownership ([c52106e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c52106eb89c54d2d25e5fc0f09373bd94288a606))
* **tenancy:** preserve platform administrator ownership ([f5512bc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f5512bc263a831e4c17f34bcd7d4c4a16d159bfd))
* **tenant-workspace:** speed up dashboards and clarify engine access ([f49065d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f49065d2b99376dde37b978020777eecc963f371))
* **tenant-workspace:** speed up dashboards and clarify engine access ([0df5456](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0df545609cf127822b92905bfaf060e41585ba10))
* tighten migration 084 columns in place to avoid ORA-01758 ([ccebdea](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ccebdea6cef67dd9e7adc2af7740cac681aa4f32))
* **ui:** clarify engine settings ([b945e51](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b945e5168ad474e9603f2b373961fc6c19c80580))
* **ui:** clarify engine settings ([dd67d37](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/dd67d37f69daaaffcc0fd180b3ea8454c13cdc84))
* **ui:** keep Cloud sign-in actions visible on Linux ([cd7a320](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cd7a32002a32d815e8b97f9a6a3dc1a534b0b97f))
* validate and scope deployed editor handoffs ([afce147](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/afce147a2c10d19d9a90e70740c6e5a17541b4b1))
* **vcs:** preserve scoped saves and explicit authorization bindings ([b56a9de](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b56a9deeb5a9453a295f6e3ca882f90847739040))
* **vcs:** publish saved trees and verify dirty baselines ([7fc5a76](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7fc5a76db1a8cb8f84392139e62dc23f84c931cb))
* **versioning:** bind saved diagram reads to project and file ([05b1963](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05b19639ff3b5049316607cec65aaf881cf7587b))
* **versioning:** checkpoint removed project files explicitly ([ae9f242](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ae9f2429ead72fbba0881898ceed5f792d70b7d2))
* **versioning:** restore contents and checkpoints atomically ([f2698b1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f2698b1477b33582275e37141a5d76826a3df559))
* **versioning:** scope restore effects and guard stale continuations ([4364c4b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4364c4b6c843e871806d2d45b8ae7364c9912b12))
* widen Oracle evidence in migration 100 without losing it ([f90f02b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f90f02bfba3c8729110d4a29695ef95d16022d22))
* **workflows:** bind session actions and deployment revisions ([b7d09ea](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b7d09ea69ded8901ba44d2d3e4955a3d4819441a))

## [0.40.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.5...v0.40.6) (2026-11-20)

### Changes

- **dashboard:** Starts project and file totals earlier on workspace reload and reduces duplicate database reads during permission loading.

Full upgrade, compatibility and verification details: [v0.40.6 release notes](docs/releases/v0.40.6.md).

## [0.40.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.4...v0.40.5) (2026-11-20)

### Changes

- **frontend:** Aligns the Cloud sign-in and organization finder with Carbon’s responsive grid and spacing scale.

Full upgrade, compatibility and verification details: [v0.40.5 release notes](docs/releases/v0.40.5.md).

## [0.40.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.3...v0.40.4) (2026-11-20)

### Changes

- **frontend:** Starts workspace dashboard queries early and displays each dashboard section as its data becomes available.

Full upgrade, compatibility and verification details: [v0.40.4 release notes](docs/releases/v0.40.4.md).

## [0.40.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.2...v0.40.3) (2026-11-20)

### Changes

- **frontend:** Adds space below the header on the organization picker.

Full upgrade, compatibility and verification details: [v0.40.3 release notes](docs/releases/v0.40.3.md).

## [0.40.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.1...v0.40.2) (2026-11-19)

### Changes

- **frontend:** Keeps an organization switch stable when another workspace is open in the same browser.

Full upgrade, compatibility and verification details: [v0.40.2 release notes](docs/releases/v0.40.2.md).

## [0.40.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.40.0...v0.40.1) (2026-11-19)

### Changes

- **frontend:** Revalidates the browser entry document after an upgrade and opens verified workspaces while membership choices load.

Full upgrade, compatibility and verification details: [v0.40.1 release notes](docs/releases/v0.40.1.md).

## [0.40.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.39.0...v0.40.0) (2026-11-19)

### Changes

- **authentication:** Adds a membership-based organization picker to Cloud sign-in and moves workspace switching into the account menu.

Full upgrade, compatibility and verification details: [v0.40.0 release notes](docs/releases/v0.40.0.md).

## [0.39.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.38.1...v0.39.0) (2026-11-19)

### Changes

- **runtime-logging:** Adds runtime log level and category controls, ECS-aligned JSON output, and safe TypeORM query diagnostics.
- **mission-control:** Engine pickers show each engine's full friendly name on one readable line.
- **project-git-settings:** The project Git settings token guide now shows instructions only for the Git provider in use instead of listing every provider.
- **plugin-toolchain:** Build the plugin installer and manager acquisition tools with Go 1.26.11.
- **login:** A returning user who signs in with a method their account has not connected now sees a clear, stable instruction to use the method they signed up with.
- **tenant-workspace:** Reduces the work needed to open the dashboard and displays full engine names in the Mission Control engine selector.

Full upgrade, compatibility and verification details: [v0.39.0 release notes](docs/releases/v0.39.0.md).

## [0.38.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.38.0...v0.38.1) (2026-11-16)

### Changes

- **platform-signup-bootstrap:** The pooled platform signup bootstrap can now disable a sign-in provider it manages, as long as at least one provider stays enabled.

Full upgrade, compatibility and verification details: [v0.38.1 release notes](docs/releases/v0.38.1.md).

## [0.38.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.37.0...v0.38.0) (2026-11-14)

### Changes

- **runtime-dependencies:** Update the backend runtime to Node.js 24.22.3 and the managed-shard bootstrap runtime to Node.js 26.13.1 to fix CVE-2026-123863, a denial of service caused by improper HTTP/2 session teardown.
- **frontend-deployment:** Adds verified HTTPS and optional client certificate authentication to the frontend NGINX connection to a deployment-provided backend gateway.
- **sso:** Enable OIDC and SAML sign-in when the browser uses a separate public EnterpriseGlue API origin.

Full upgrade, compatibility and verification details: [v0.38.0 release notes](docs/releases/v0.38.0.md).

## [0.37.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.36.1...v0.37.0) (2026-11-12)

### Changes

- **cloud-authentication:** Enforce the configured company sign-in policy on managed tenant sessions.
- **cloud-authentication:** Support Cloud sign-in with a Microsoft application registered for organizational and personal accounts.
- **cloud-onboarding:** Bind managed Cloud organization requests to a verified account and deliver request notifications through the host email service.
- **cloud-authentication:** Require a verified second factor for configured managed Cloud platform administrators.
- **host-dashboard:** Expose a dashboard slot for first-run project and engine setup actions.
- **documentation:** Let a verified managed Cloud user open documentation through the existing account handoff.
- **oracle-images:** Retain Oracle publication receipts in GHCR and provide verified inputs for manual documentation catch-up.

Full upgrade, compatibility and verification details: [v0.37.0 release notes](docs/releases/v0.37.0.md).

## [0.36.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.36.0...v0.36.1) (2026-11-12)

### Changes

- **cloud-authentication:** Allow verified email links to establish managed Cloud sessions and protect link requests with optional Turnstile verification.
- **git:** Seed an active GitHub provider when a managed Cloud tenant is created.

Full upgrade, compatibility and verification details: [v0.36.1 release notes](docs/releases/v0.36.1.md).

## [0.36.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.10...v0.36.0) (2026-11-11)

### Changes

- **config-bundles:** Process a directory of configuration bundles in filename order at startup or through the live CLI and CI workflow, and report every bundle even if one fails.
- **mission-control:** Omits tenant mapping controls and diagnostics from the details dialog for engines registered by a managed workload.
- **plugin-toolchain:** Rebuild the plugin installer and manager acquisition tools with the fixed Go x/net module.
- **mission control:** Apply the process start-time range to Mission Control BPMN activity badges.
- **runtime-images:** Require the patched Wolfi glibc runtime in the backend, frontend, and managed-shard bootstrap images.

Full upgrade, compatibility and verification details: [v0.36.0 release notes](docs/releases/v0.36.0.md).

## [0.35.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.9...v0.35.10) (2026-11-05)

### Changes

- **release-authorization:** Resume frozen toolchain distribution publication without changing its authenticated original receipt or immutable lock.
- **mission-control:** Resolve opaque process-definition identifiers in instance lists and verify live process existence before reading variables.

Full upgrade, compatibility and verification details: [v0.35.10 release notes](docs/releases/v0.35.10.md).

## [0.35.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.8...v0.35.9) (2026-11-04)

### Changes

- **mission-control:** Returns generic not-found responses for missing runtime process instances without changing tenant or runtime authorization.

Full upgrade, compatibility and verification details: [v0.35.9 release notes](docs/releases/v0.35.9.md).

## [0.35.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.7...v0.35.8) (2026-11-04)

### Changes

- **security:** Pin the fixed Expat library in backend, frontend and managed-shard bootstrap runtime images.

Full upgrade, compatibility and verification details: [v0.35.8 release notes](docs/releases/v0.35.8.md).

## [0.35.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.6...v0.35.7) (2026-11-02)

### Changes

- **mission-control:** Preserves not-found responses for missing historic process instances after tenant and runtime authorization.
- **deployment:** Remove unused Git filesystem storage from Docker and OpenShift deployment templates to reflect database-backed application persistence.

Full upgrade, compatibility and verification details: [v0.35.7 release notes](docs/releases/v0.35.7.md).

## [0.35.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.5...v0.35.6) (2026-11-02)

### Changes

- **tenancy:** Preserve global platform group authority during native tenant ownership upgrades and keep single-tenant setup links routable.

Full upgrade, compatibility and verification details: [v0.35.6 release notes](docs/releases/v0.35.6.md).

## [0.35.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.4...v0.35.5) (2026-11-02)

### Changes

- **deployments:** Restore project deployment options and native JSON variable editing, and update filesystem matching dependencies to their patched releases.
- **release-authorization:** Complete frozen release publication with source-bound image-workflow handoffs, authenticated package observations and retained security evidence without scanner caches.
- **workflows:** Bind browser actions to their original context, verify deployment and variable transport, and use explicit directory presentation contracts with permission-based administration.

Full upgrade, compatibility and verification details: [v0.35.5 release notes](docs/releases/v0.35.5.md).

## [0.35.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.3...v0.35.4) (2026-10-30)

### Changes

- **engines:** Keep externally managed engines readable in the authorization-filtered engine inventory after workload registration.

Full upgrade, compatibility and verification details: [v0.35.4 release notes](docs/releases/v0.35.4.md).

## [0.35.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.2...v0.35.3) (2026-10-28)

### Changes

- **git-providers:** Remove the Bitbucket SDK and its unfixed deepmerge dependency while preserving the Bitbucket Cloud provider API.
- **plugin-toolchain:** Rebuild plugin acquisition tools with the patched Go JOSE JWK parser.

Full upgrade, compatibility and verification details: [v0.35.3 release notes](docs/releases/v0.35.3.md).

## [0.35.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.1...v0.35.2) (2026-10-27)

### Changes

- **runtime-dependencies:** Upgrade qs to 6.16.1 across the production dependency closure to repair CVE-2026-110816 query serialization denial of service.
- **frontend-host:** Keep substantial access-control editors within their existing settings navigation.

Full upgrade, compatibility and verification details: [v0.35.2 release notes](docs/releases/v0.35.2.md).

## [0.35.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.35.0...v0.35.1) (2026-10-24)

### Changes

- **runtime-dependencies:** Repair runtime and browser/build dependency vulnerabilities in MSAL, parsing, mail, HTTP, schema validation, DOMPurify and Vite/Vitest while preserving database adapters and tenant controls.

Full upgrade, compatibility and verification details: [v0.35.1 release notes](docs/releases/v0.35.1.md).

## [0.35.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.34.0...v0.35.0) (2026-10-23)

### Changes

- **documentation account:** Allow documentation readers to manage their shared account profile without organization onboarding.
- **plugins:** Documents both v1 frontend bootstrap APIs and requires OpenAPI coverage evidence before shipping; also patches the IPv6 parser vulnerability that blocked Oracle image qualification.
- **documentation publication:** Prepare customer documentation independently from OSS releases using the existing canonical release notes and stable page impact metadata.

Full upgrade, compatibility and verification details: [v0.35.0 release notes](docs/releases/v0.35.0.md).

## [0.34.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.33.0...v0.34.0) (2026-10-22)

### Changes

- **documentation:** Requires central account proof for automatic customer documentation domain admission.
- **documentation:** Adds private customer documentation workspaces with verified-domain or individual-reader admission, checked on every protected request.

Full upgrade, compatibility and verification details: [v0.34.0 release notes](docs/releases/v0.34.0.md).

## [0.33.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.32.1...v0.33.0) (2026-10-21)

### Changes

- **identity:** Adds tenant-scoped outbound proxy routing for SSO, with portal and headless configuration.

Full upgrade, compatibility and verification details: [v0.33.0 release notes](docs/releases/v0.33.0.md).

## [0.32.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.32.0...v0.32.1) (2026-10-21)

### Changes

- **runtime-security:** Patches the plugin verification tools and runtime certificate and curl security floors.

Full upgrade, compatibility and verification details: [v0.32.1 release notes](docs/releases/v0.32.1.md).

## [0.32.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.31.1...v0.32.0) (2026-10-16)

### Breaking changes

- **security:** Use one application-issued, signed and session-bound XSRF-TOKEN cookie echoed in the X-XSRF-TOKEN header.

### Changes

- **oracle:** Make the historical database migrations replay safely on Oracle and PostgreSQL, so partially populated Oracle schemas no longer fail with ORA-00902 or ORA-01758, and nullability or type changes keep existing data.
- **runtime:** Use vendor-patched zlib runtime packages across application and bootstrap images and remove the expired CVE-2026-85091 scanner exception.

Full upgrade, compatibility and verification details: [v0.32.0 release notes](docs/releases/v0.32.0.md).

## [0.31.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.31.0...v0.31.1) (2026-10-14)

### Changes

- **oracle:** Repair historical boolean migration SQL for Oracle releases without SQL BOOLEAN support.
- **backend dependency security:** Remove the vulnerable braces build dependency and upgrade the Spanner SDK to eliminate vulnerable OpenTelemetry dependencies from the backend.

Full upgrade, compatibility and verification details: [v0.31.1 release notes](docs/releases/v0.31.1.md).

## [0.31.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.30.1...v0.31.0) (2026-10-13)

### Changes

- **oracle:** Add an optional required AES256 Oracle native network encryption profile across application pools, Oracle-capable images, deployment configuration, and qualification.
- **release-authorization:** Complete frozen release publication with source-bound image-workflow handoffs, authenticated package observations and retained security evidence without scanner caches.

Full upgrade, compatibility and verification details: [v0.31.0 release notes](docs/releases/v0.31.0.md).

## [0.30.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.30.0...v0.30.1) (2026-10-11)

### Changes

- **identity:** Honor explicitly assigned, policy-approved organization-read access in neutral Cloud account sessions without granting platform write authority.

Full upgrade, compatibility and verification details: [v0.30.1 release notes](docs/releases/v0.30.1.md).

## [0.30.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.29.3...v0.30.0) (2026-10-10)

### Breaking changes

- **package-dependencies:** Separate browser installation dependencies from optional server peers while retaining shared import paths, and correct frontend runtime dependency declarations.

### Changes

- **browser-evidence:** Verify the fonts used by browser evidence before bounded capture, avoiding an unused FontFaceSet stall and preserving cleanup diagnostics.
- **documentation account access:** Add a documentation-only sign-in journey and limited, revocable documentation sessions without creating a Cloud tenant.
- **release-authorization:** Separate local implementation, code shipping and explicitly approved multi-PR release publication, with exact generated release-document verification.
- **plugin-toolchain:** Rebuild pinned ORAS and Cosign releases with Go 1.26.9 in both installer and manager images, eliminating newly reported Go standard-library denial-of-service vulnerabilities.
- **plugin-toolchain:** Rebuild installer and manager OCI tools with patched x/net HTTP/2 modules and their required Go dependency floors.
- **release-documentation:** Generate concise and detailed batch documentation from the complete unreleased fragments and corrected evidence, retaining historical package records without repeating bumps.
- **release-preparation:** Keep an unpublished reserved release at its approved version when Release Please runs in manifest mode.
- **release-authorization:** Publish and recover one frozen release batch through signed immutable records, reviewed workflow repairs and observed registry receipts.

Full upgrade, compatibility and verification details: [v0.30.0 release notes](docs/releases/v0.30.0.md).

## [0.29.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.29.2...v0.29.3) (2026-10-08)


### Bug Fixes

* **ci:** let Oracle smoke own pristine migration bootstrap ([1755c2e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1755c2ed5c70bb028ac6d5dbf88083da651d914a))
* **db:** exclude migration helpers across all compiled adapters ([d92b370](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d92b37094207001129c130cc23f8941b3b94bc7d))
* **installation:** preserve compiled migration identity and macOS shutdown ([24f7c8e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/24f7c8e87b1e7c3ec8fe7e50f36db0bd9a4a583d))
* **installation:** qualify supported Node and patched runtime OS floors ([964d098](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/964d098c1dffc10c19f4da9249eedf36f3651a05))
* **installation:** restore compiled upgrades and qualified runtime ([a5a67e9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a5a67e9fd3476c29c066d27baba37f35d16fd335))

## [0.29.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.29.1...v0.29.2) (2026-10-08)


### Bug Fixes

* **auth:** align email signup choice and explain passkeys ([923d6bc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/923d6bcccc1726c534284d430a9d42f644e0f567))
* **auth:** unify public authentication appearance ([7a890ad](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7a890ad30c7a72815ccfdfa53ae89016768ff0ea))
* **deps:** include security patches in developer image installs ([122ad52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/122ad525d4e6be3978ff4eb565ce145c4e212a4a))
* **deps:** prepare approved security floors pending qualification ([88c0a41](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/88c0a413bb7521dc1bcd5427b62626419756014d))
* **deps:** qualify bounded SQL diagnostics and refreshed production dependencies ([d67e69d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d67e69d10cd5d2c55809b55c80433dcfba796d8f))
* **deps:** repair production image security qualification ([705f1db](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/705f1db257fc3124661f069eff32f09aa7397a8f))

## [0.29.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.29.0...v0.29.1) (2026-09-28)


### Bug Fixes

* **dashboard:** align filters without an engine ([1f03951](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1f03951bbbe69407289bb0afa782d6d2c18fd585))

## [0.29.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.13...v0.29.0) (2026-09-27)


### Features

* **auth:** add Cloud email and passkey signup ([3c57a83](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3c57a83ae28dcd1c3ad69186da434da091124a40))
* **auth:** bind Cloud passkey schema owner and runtime grants ([303a5db](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/303a5dbda10cecd44a2c05f7847105a9d6878912))


### Bug Fixes

* **auth:** keep Cloud passkey sign-in reachable on login ([04c101f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/04c101faf54390836867b2f04c764f0a8005b0d2))
* **auth:** qualify owned passkey fixture and patched WebAuthn runtime ([e7fc67e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e7fc67e3604367c3a9f2b7cb1b102fd553ce0f08))
* **auth:** stage signed passkey schema transition and CI repair ([9b09ad8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9b09ad88347d1cce055175687aec093c8f66bdc3))
* **ui:** keep Cloud sign-in actions visible on Linux ([cd7a320](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cd7a32002a32d815e8b97f9a6a3dc1a534b0b97f))

## [0.28.13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.12...v0.28.13) (2026-09-25)


### Bug Fixes

* **dev:** verify documented fresh-clone teardown ([574e476](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/574e47685297d662417dd38bbcfb97a841dce4ea))

## [0.28.12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.11...v0.28.12) (2026-09-25)


### Bug Fixes

* **dev:** align Linux Compose ownership with checkout user ([1cb823c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1cb823c7a959f90a110bd8e13d2a4ca30784e49f))
* **dev:** make fresh Linux Compose startup writable and test it in CI ([6f66ab8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6f66ab846878d7a1f54a9a7e23f31a0e3cdbe999))

## [0.28.11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.10...v0.28.11) (2026-09-24)


### Bug Fixes

* **dev:** make Compose first startup reliable ([e4cd657](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e4cd657d0a92f2c05f43a9ef439b0e8bd85c3019))

## [0.28.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.9...v0.28.10) (2026-09-24)


### Bug Fixes

* **schema:** recognize signed Cloud passkey epoch for rollback ([02f20c1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/02f20c1c9f2496c019600620a6e7903ebef75a15))

## [0.28.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.8...v0.28.9) (2026-09-24)


### Bug Fixes

* **auth:** align organization chooser with pooled login ([23d1fe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/23d1fe0b5929078ad37a7fb4fed87825a6689a40))
* **auth:** clarify personal email discovery on landing ([e3e7065](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e3e7065f6791abcbe9215902fb6c06a4428ef2ab))
* **auth:** find organizations after cloud account sign-in ([579b0ad](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/579b0ad29242f2357832794ebe9db779df60bd37))
* **auth:** separate Cloud signup from account discovery ([1924c52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1924c523d4c30c16c90172b755c708b353ba69eb))

## [0.28.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.7...v0.28.8) (2026-09-22)


### Bug Fixes

* **authentication:** link global SaaS OIDC providers ([51f16ed](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51f16edb847e69901a5875bc3bd90cbf477ccefe))

## [0.28.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.6...v0.28.7) (2026-09-21)


### Bug Fixes

* **ui:** clarify engine settings ([b945e51](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b945e5168ad474e9603f2b373961fc6c19c80580))

## [0.28.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.5...v0.28.6) (2026-09-20)


### Bug Fixes

* **config:** honor bootstrap authority in verify mode ([2cf705d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2cf705df63e1033cccd62771156fb91650e0a43b))

## [0.28.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.4...v0.28.5) (2026-09-19)


### Bug Fixes

* **auth:** retain verified tenant release context ([74078f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/74078f98245ffd40bec16c3410abdcc558818741))
* **security:** remove node-gyp from runtime images ([f87ed41](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f87ed41d2888c9d8150a7635f5092ccb86981943))

## [0.28.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.3...v0.28.4) (2026-09-16)


### Bug Fixes

* **codex:** preserve staging runtime config ownership ([4ba9fc7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4ba9fc79b0e77b2954e52199ea1ea9976fd961d9))

## [0.28.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.2...v0.28.3) (2026-09-15)


### Bug Fixes

* **codex:** document staging pruning recovery ([e49d7c2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e49d7c256399da8482c59e62408edb6316487580))

## [0.28.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.1...v0.28.2) (2026-09-15)


### Bug Fixes

* **auth:** preserve pooled linking error contract ([245c0cb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/245c0cb083a24a09de972dac15c70f68d9b27a34))
* **auth:** securely link secondary OIDC providers ([d2b93df](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d2b93df6345aaab22a84228ea421e7ca800d969a))

## [0.28.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.28.0...v0.28.1) (2026-09-15)


### Bug Fixes

* **codex:** harden staging drain recovery guidance ([8365bc5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8365bc53e3d7dda154b47408f701acd48ee7b564))

## [0.28.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.6...v0.28.0) (2026-09-15)


### Features

* **codex:** add cloud staging delivery workflow ([be2f3bc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/be2f3bc88b2962ff5435caf70991c9f940776b9e))

## [0.27.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.5...v0.27.6) (2026-09-15)


### Bug Fixes

* **release:** centralize package version authority ([fdfc293](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fdfc2939dc9087066bab62f40de978755ff24346))

## [0.27.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.4...v0.27.5) (2026-09-15)


### Bug Fixes

* **workflows:** guard retired repository lifecycle ([2ede1e2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2ede1e264ebe617d3f5d8b566d084e2a518c0e95))

## [0.27.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.3...v0.27.4) (2026-09-13)


### Bug Fixes

* **postgres:** preserve restricted preflight readiness ([0166607](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/01666074b20e06bb47183a233c2efcd058f637b3))
* **postgres:** verify schema epoch through catalogs ([e8ca7c2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e8ca7c2bf0eb0ccc40bcdcffb534b0aa948e2a65))

## [0.27.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.2...v0.27.3) (2026-09-13)


### Bug Fixes

* **database:** isolate migration runtime config ([130a11c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/130a11cf38a6f0df67df2b1bc1afa9c0dc2b64f4))
* **database:** retain adapter config validation ([cae7f96](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cae7f962f59bc20641996a2214f52a3f976533ba))
* **release:** regenerate schema epoch manifest ([c65e1b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c65e1b412e3018258dc738941620a8b8eebc916c))
* **release:** regenerate schema epoch manifest deterministically ([5ed7491](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5ed749139b46c15330b9c0f0017df8897952c183))

## [0.27.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.1...v0.27.2) (2026-09-13)


### Bug Fixes

* **helm:** validate least-privilege database hooks ([b21dfaa](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b21dfaa738211a960988454aafe1e5d6e7997f0b))

## [0.27.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.27.0...v0.27.1) (2026-09-13)


### Bug Fixes

* **frontend:** enforce lean public signup bundles ([e1f517f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e1f517fb6d05584be9ca92f393cc06ac610c8811))

## [0.27.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.26.2...v0.27.0) (2026-09-13)


### Features

* **identity:** add multi-provider cloud signup ([9ae5dfd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9ae5dfd59799add8654f98e260a583756e2b6d2c))


### Bug Fixes

* **ci:** gate merge groups on completed PR scans ([6affa09](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6affa09b00a21f9f3cbd4e50a36f7f1012773dfd))
* **ci:** keep merge-group CodeQL within queue window ([6a1b013](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6a1b0133354a1f23ad2332d17bde9d56ce27d19e))
* **security:** patch zlib and reduce Actions usage ([37ac73c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/37ac73c23df91812641ed15432cfb4bb4ad8df4f))
* **security:** patch zlib CVE-2026-85091 ([aabc241](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aabc24111aa9989279149b4154fc7dd16af9b525))
* **security:** refresh managed bootstrap packages ([f6989f3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f6989f35ff36b2df74ac6eca18661a6068d33c34))

## [0.26.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.26.1...v0.26.2) (2026-09-12)


### Bug Fixes

* **auth:** preserve authenticated release context ([34873e1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34873e1d42820937b925c7348759555af97cc743))
* **delivery:** catch package bumps before push ([53323ae](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/53323ae68272759ae1c1b09cad5c770efcaad136))
* **security:** refresh bootstrap runtime packages ([a1e2c71](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a1e2c71b92da3903e79eb17c226488dedb433a0a))
* **security:** refresh runtime image bases ([0e3c7d7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0e3c7d737664689c7228b68c584a8f70221d13ad))

## [0.26.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.26.0...v0.26.1) (2026-09-11)


### Bug Fixes

* **mission-control:** preserve engine context and Voyager access ([0abe4c5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0abe4c5c64754c06acc2f3d0a0129fd1355d3201))

## [0.26.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.25.0...v0.26.0) (2026-09-10)


### Features

* **database:** bootstrap fresh managed shards ([0f37560](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0f3756041d84f9cacc43ac549ecdcda95837d89c))
* **release:** align fragment version semantics ([cd46e05](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cd46e05ca482e70bc9d80fac622e68f16a3fdb18))


### Bug Fixes

* **auth:** avoid signup session bootstrap probes ([067d818](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/067d8189ccc4687bcfba9d22eda9de2c27216b65))

## [0.25.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.24.2...v0.25.0) (2026-09-10)


### ⚠ BREAKING CHANGES

* **identity-runtime:** upgrade or drain every shared-schema API and worker before applying PostgreSQL policy migration 1700000000131; use separate owner and restricted runtime identities. Old runtimes cannot serve the expanded schema, and rollback requires the pre-upgrade backup.

### Features

* **database:** add signed schema epoch bridge ([8cafba0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8cafba05d7a3791b9e43bde4f33cd01135d121ba))
* **release:** add durable effect settlement foundation ([8ff1800](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8ff180006b0630a512ee425b0a9e1481da6bc8db))
* **release:** open effect cohort before workloads ([1326a7c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1326a7ccfb87b50aee5bb9b095c561c95eadc17f))


### Bug Fixes

* **ci:** await release label convergence ([8b4b740](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8b4b74041fcfcc7cff970c8de67bb254ad74d93e))
* **ci:** harden generated release metadata ([99c7859](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/99c785943dc2d905f23ddc41ce65fbe4d4a15f3e))
* **ci:** preserve Release Please classification ([a472947](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a4729472638097eddf939ed1114a82d5a7ba1c4e))
* **database:** bind bridge runtime cohort grants ([ce5ca35](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ce5ca35ff8f737f27c2ae14f05d576e263151ac6))
* **database:** close schema bridge rollout gaps ([20e43b8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/20e43b8a250a3dfba9df68a2ecdab9f3cbcc336d))
* **database:** harden exact schema bridge transition ([79e4f64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/79e4f64590c253874314a0a152ccf23d31df60d5))
* **db:** govern schema epoch grant SQL ([67f23ee](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/67f23ee5907889b3b9088c24d2b7062a64692ce6))
* **frontend:** surface trusted system main navigation ([4194826](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4194826755f44f600aad67fefb85b8dc0e741ba7))
* **identity-runtime:** close protected PostgreSQL regressions ([6249191](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6249191e5c259b742b04311b63875cf58a16819c))
* **identity-runtime:** enforce PostgreSQL context and isolate API bootstrap ([67a5ada](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/67a5ada6b0fd33c2ba72c6efaf1bbfec58a1f44b))
* qualify bounded schema bridge upgrades ([3b781d1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3b781d1105ad69b69d97c1a790ebebaab4618f0c))
* **release:** bind schema bridge cohort inventory ([5260aec](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5260aece87bde53549d2cd1791b366995fa7182f))
* **release:** order batched effect claims ([31a214c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/31a214c3bfc88d622a911012f7495dcdfc31efb8))
* **release:** serialize expired effect recovery ([f905d6a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f905d6aba2dd08a7531b043488c6afbb8c88f1d6))
* serialize release effect admission ([aeeab56](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aeeab5670ec0d4e8981fb8d486b8c65255a42761))

## [0.24.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.24.1...v0.24.2) (2026-09-09)


### Bug Fixes

* **deps:** patch backend and toolchain security dependencies ([1562a77](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1562a77a4035c8d062a198b36ca70d3b56b6f9c9))
* **deps:** patch backend email and plugin toolchain vulnerabilities ([17b06f1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/17b06f160041e23bf6f87e17085527856bf350f6))
* **release:** bind candidate charts to exact source identity ([def1b7a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/def1b7aec208de78fa11eb352a888d4d75cf817c))
* **security:** bound ZIP imports and patch request logging ([c135a45](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c135a45706eac51f540a36adee3f763337f8e5f8))
* **security:** refresh restricted PostgreSQL runtime grants after migrations ([eed369b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eed369b6807da86f4772cc2b27c49120be9acf25))
* **security:** validate and own archive request buffers ([1061abf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1061abfbafd346919100878b3af8e40efda85583))
* **ui:** align Carbon login and application presentation ([7f1ebb6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7f1ebb6fb1620f0412b2758169a086a66b34c5bf))

## [0.24.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.24.0...v0.24.1) (2026-09-09)


### Bug Fixes

* **engines:** permit REST requests beneath approved managed base ([d0e01b6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d0e01b69c7da108ac33457ac0086b3f867f4d85e))

## [0.24.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.23.0...v0.24.0) (2026-09-08)


### Features

* **engines:** add tenant-managed workload registration ([c83ba31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c83ba31ea363bfd01dacd542760071df0b6b774b))


### Bug Fixes

* **ci:** wait for verified pooled fixture TLS readiness ([0ad4b10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0ad4b10ad9626f11eb28b903fad6773c521cf5d8))
* **engines:** authenticate replay intents with one keyed MAC ([e87a22a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e87a22a82fba05992b94a1ecca8db2b3778294f1))

## [0.23.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.22.0...v0.23.0) (2026-09-08)


### Features

* **auth:** add Sign in with Apple ([8166b70](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8166b705c74678247cc2587fb85172214146262b))

## [0.22.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.21.3...v0.22.0) (2026-09-08)


### Features

* **cloud:** add managed account onboarding entry ([3d85b08](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3d85b084bc5c8a74ee2a622968348813330578b8))
* **tenancy:** add platform cloud identity boundary ([ab13d01](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab13d01ca1d75adc4ff16e2228a3b18bf6f8913d))
* **ui:** expose host-owned Carbon system kit ([d32dc55](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d32dc55f0b471372d6f2e0ba9685114522420f65))


### Bug Fixes

* **authz:** model request-selected cloud actions ([be0385c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/be0385c84babab0df6c039121b907ad29da94588))
* **release:** declare Carbon host package impact ([ed48f21](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ed48f21b9caf7d604892c1650da9f8254c93287a))
* **release:** version Carbon plugin contract ([ef9c544](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ef9c544d7f36a622cfc52a393c15a7c1299e345c))
* **tenancy:** complete managed Cloud account session boundary ([b1d573d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b1d573d07819af29b7a6f4c6d421f71e2173a28f))

## [0.21.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.21.2...v0.21.3) (2026-09-08)


### Performance Improvements

* **ci:** add focused frontend verification ([8fbf7b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8fbf7b4933119a1ef2cd5686168389c49fadae92))

## [0.21.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.21.1...v0.21.2) (2026-09-07)


### Bug Fixes

* **frontend:** scope notifications to tenant routes ([f86a3e0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f86a3e0b555b20a14dd738c786b521181d333d43))
* **frontend:** scope tenant shell data to tenant routes ([8b38c78](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8b38c7849236a7761459d40a93189764471f04c7))

## [0.21.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.21.0...v0.21.1) (2026-09-07)


### Bug Fixes

* synchronize BPMN marker readiness with release qualification ([ef2ea20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ef2ea20b12a2d885ed260a1e461e9672f5787ef8))

## [0.21.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.9...v0.21.0) (2026-09-07)


### ⚠ BREAKING CHANGES

* **identity:** preserve pooled account and browser-session boundaries

### Features

* **tenancy:** add durable release activation receipts ([d6114c1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d6114c105cf429724f6bd24836d2a23292025553))


### Bug Fixes

* **ci:** align activation package release metadata ([2947a0c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2947a0c840f4704e66eb9ef57f427ee36a3ca970))
* **ci:** harden pooled qualification fixtures and evidence reads ([5720559](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5720559b18610b6438aa7ea1ce2dce15457fa8f1))
* **identity:** preserve pooled account and browser-session boundaries ([3b7600e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3b7600eee2561b158eda53116375732670329bcb))

## [0.20.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.8...v0.20.9) (2026-09-05)


### Bug Fixes

* **packaging:** align frontend host with shared activation patch ([e56d3a7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e56d3a740cbb5fbde74026cf88a3870540dec080))
* **release:** require exact candidate toolchain rehearsal ([da61cbe](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/da61cbefe7949acbbd1ec1627c0ab6f9e3725361))
* **tenancy:** fence conditional release activation against current tenant state ([6cb05bd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6cb05bd31610ccc213cc9c593ef8801649d5d11b))

## [0.20.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.7...v0.20.8) (2026-09-05)


### Performance Improvements

* **ci:** qualify release candidates once ([5a94eb9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5a94eb9703f3024018cc885a9c5ea767451348e8))

## [0.20.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.6...v0.20.7) (2026-09-05)


### Bug Fixes

* **auth:** route SaaS session refresh through tenant shard ([786c989](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/786c9892dfeaaeaf0771a642b803efc49041c16c))

## [0.20.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.5...v0.20.6) (2026-09-04)


### Bug Fixes

* make admin bootstrap replica safe ([866b785](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/866b785f7c0325de4fb4898b8032536b887fd82f))
* **plugin-platform:** authorize active tenant routes ([c13949b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c13949b6d4c0d6f3d4aa582d4d094fcdde6eeb26))
* **release:** enforce package versions with source changes ([0b65784](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0b65784acb216412bdce5b8dec0651ca6623ee86))
* **release:** version published packages with source changes ([8662a4f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8662a4f97d9d200da1f049c339f894e7d82164ef))

## [0.20.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.4...v0.20.5) (2026-09-04)


### Bug Fixes

* **ci:** accept compatible plugin API patches ([6bbaca7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6bbaca71e86fffcfcf657436444b5ecf658ce864))
* **ci:** classify release hardening helpers ([b3daacc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b3daacc2f7b67cafd8cfbf67d1e5ebb3dca52df1))
* **ci:** fully replace wildcard test fixtures ([e6f3912](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e6f3912adfaa80cea649ad41165fb68dde4bb650))
* **ci:** keep generated releases on fast path ([9ed61a0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9ed61a05577e894a94d8868c6d30e3a9052fe1cb))
* **packages:** version immutable API payload ([ad45b1a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ad45b1a8b0cc1fca7b5e3febe50612076f36dcf8))
* **release-runtime:** harden candidate publication and CI feedback ([9e6ffe2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9e6ffe2ff8c3a7ed3e92749f6f54053b7ab306f0))

## [0.20.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.3...v0.20.4) (2026-09-03)


### Bug Fixes

* **mission-control:** restore completed Operaton details ([2717a98](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2717a9841e49da64ea0e9e8f31850766b2be34f5))
* **mission-control:** restore completed Operaton details ([5c2c078](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5c2c078dc472b259c547be3e5f1761567c04fff4))
* **release:** fetch canary tag history ([901ee70](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/901ee707937a985efbbb6a43783f0698a6136f5f))
* **release:** fetch canary tag history ([4ee0513](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4ee05138248b1a3041d985c6f10a31a48e38d689))
* **release:** verify reusable image signer ([87f35b0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/87f35b0592ee237265a421302829c61590fb733c))
* **release:** verify reusable image signer ([21cd510](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/21cd510f84831c44125d62d55e6a8efc4a621f15))


### Performance Improvements

* **release:** compile frontend natively ([f256dd8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f256dd8e1f7cb560f8efd091d6c39154a32a72b2))
* **release:** compile frontend natively ([ab8ca88](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab8ca88bcaa14353b2ccdc157aa333750625d152))

## [0.20.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.2...v0.20.3) (2026-09-03)


### Bug Fixes

* **ci:** authenticate reusable source image builds ([e932dda](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e932ddaa2960f78c90a686ad77c68b0ce30389e6))
* **ci:** authenticate reusable source image builds ([7434be5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7434be5c0b1d51e030fe477d152b4ea34f42598c))
* **packages:** resolve workspace protocols before publish ([72d9d4c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/72d9d4cc9fb018554d59a8d42f8b7742f768e244))
* **packages:** resolve workspace protocols before publish ([30bf5a1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/30bf5a14edc43eb7e093239f1d1e5da6382b7687))
* **plugins:** focus delivery on OSS plugin architecture ([21cc3f6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/21cc3f64cf8bd0046ebd58111def0be372d249b1))
* **plugins:** focus delivery on OSS plugin architecture ([4ba1cc2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4ba1cc2b8e89996252890f0cee22a94669e17238))
* **release:** describe external plugin consumers ([b07fd6b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b07fd6b5edba88286a8834af1e56814205a71b48))
* **release:** describe external plugin consumers ([310fd3f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/310fd3f39c97935c21b6a045498a0a2afad49242))

## [0.20.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.1...v0.20.2) (2026-09-02)


### Bug Fixes

* **security:** patch production dependencies and release gate ([87dd9c5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/87dd9c554f0b3662be216d56cd48b4f73cf01715))
* **security:** patch production dependencies and release gate ([88b8e2f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/88b8e2f7d41f83b2e43474923401cb0830e0c427))

## [0.20.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.20.0...v0.20.1) (2026-09-02)


### Bug Fixes

* **ci:** avoid release label mutation races ([d8b34b7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d8b34b7d8147930e280695359c065f285e009954))
* **mission-control:** restore engine health and process views ([6a9b0f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6a9b0f906ef6f6178dad438604b76b01336192d2))
* **mission-control:** restore engine health and process views ([e68b247](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e68b24721b3cbbdaf08585302bd05f4afddfe408))
* **security:** rebuild cosign with patched grpc ([303de4f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/303de4fc1a4305e512b6cb4fa8aaf0b051c8625a))

## [0.20.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.19.2...v0.20.0) (2026-09-01)


### Features

* add managed SaaS release affinity ([b3ab5cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b3ab5cf9e3bfba18278d4544f9451b5f1b0b1591))
* add managed SaaS release affinity ([002dfa6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/002dfa66816b067fd98703db7c41bfb8bb034ccf))


### Bug Fixes

* align plugin API compatibility baseline ([6c0a971](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6c0a9712685a408ef1db4b22a825baa9492a8d0b))
* **ci:** isolate release candidate execution boundary ([5be1763](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5be176301db3fb24e2b33bb443b0c08009dcc605))
* **ci:** preserve merge-queue candidate identity ([ea76eeb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea76eeb815f0da4c4895d20da6d65d9827eb6229))
* **ci:** validate release metadata without checkout ([fdc94d9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fdc94d9cae97efb3215c58474b61fd273237b99f))
* fail closed for placement assertion signatures ([06db3f8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/06db3f8d60569d971585763f9edf896e11087985))
* **release:** align plugin chart versions ([f262f8e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f262f8ef97b49e159d6681c6ac2d682c8de5afad))
* **release:** align plugin chart versions ([2c051bd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2c051bd004c1dcadd8cc2592e2c5947c5bb77797))
* **release:** authenticate candidate package planning ([407d153](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/407d1538b73c8d2e19747b00e12ee92fd523eee0))
* **release:** isolate candidate chart diagnostics ([04516a2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/04516a2a1d6b2cdbb2d679ba4b2401d105b3f226))
* **release:** isolate candidate chart diagnostics ([4cb11e8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4cb11e85cc4dd96fc5a5c66d6c6e484946b73547))
* **release:** mount Trivy policy for candidate scans ([0c2ed2e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0c2ed2ea8bfbe3fabe34b09186e3358e5a807a15))
* **release:** mount Trivy policy for candidate scans ([d230c47](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d230c47ea3d32540aaaffa84281f331d89547fad))
* **release:** publish cloud-consumable distribution lock ([254175a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/254175a814d8742b95fe51be5ed282bc9afdd5c0))
* **security:** refresh plugin OCI tools ([a08fcde](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a08fcde45a914f39b3bb4e7b890e2a8608ea5a79))
* **security:** secure release candidate staging ([ca1adb8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ca1adb81c7f6c1062ea5f504861eb22aaa78ab55))
* version published packages for SaaS contracts ([b64327d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b64327de6879ee543081e87c262b7f1b71399561))

## [0.19.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.19.1...v0.19.2) (2026-08-28)


### Bug Fixes

* **release:** keep release charts aligned and reproducible ([#409](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/409)) ([087ebb4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/087ebb494845b6b2411504b42e114fc0969f4805))

## [0.19.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.19.0...v0.19.1) (2026-08-28)


### Bug Fixes

* **release:** allow multi-arch image builds to finish ([#407](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/407)) ([fdfcfe6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fdfcfe6ec4e15dc9cf6410381d93662e2e96c1b7))

## [0.19.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.18.0...v0.19.0) (2026-08-28)


### Features

* **saas:** add cloud-ready pooled tenancy and plugin platform ([#405](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/405)) ([b1b2e2f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b1b2e2f90cec6ab555fe07cd80b6ae1f64f4574a))

## [0.18.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.17.2...v0.18.0) (2026-08-27)


### Features

* **frontend-host:** support runtime configuration of the API base URL ([#396](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/396)) ([0ab8bc2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0ab8bc2a093240aa1027b3a3621fcd6737ed490d))
* **frontend-host:** validate list API responses at the boundary ([#395](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/395)) ([88c0343](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/88c03439339533cc0e2b0c70bd8b484978c88956))

## [0.17.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.17.1...v0.17.2) (2026-08-26)


### Bug Fixes

* **release:** version plugin runtime dependency payload ([#401](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/401)) ([9584901](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9584901e00e534510d894b399bcb7e6082149811))

## [0.17.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.17.0...v0.17.1) (2026-08-26)


### Bug Fixes

* **security:** refresh plugin toolchain OpenSSL runtime ([#399](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/399)) ([507b436](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/507b436d7969836acde2bb1069950846db4993b6))

## [0.17.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.16.2...v0.17.0) (2026-08-26)


### Features

* **tenancy:** add native pooled SaaS tenancy ([#397](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/397)) ([2e696f6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2e696f6eb7873979724af2deee65b1324becaf22))

## [0.16.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.16.1...v0.16.2) (2026-08-25)


### Bug Fixes

* **release:** bind receipts to registry charts ([#393](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/393)) ([e261e70](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e261e704d259fff9dbc593686d761be3af7ba799))

## [0.16.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.16.0...v0.16.1) (2026-08-25)


### Bug Fixes

* **release:** compare Helm chart payloads canonically ([#391](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/391)) ([17fbcc6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/17fbcc6bea348a2e12c110420fb4083bacae3ed8))

## [0.16.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.15.3...v0.16.0) (2026-08-25)


### Features

* **plugin-platform:** ship source-free manager distribution ([#388](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/388)) ([54c602b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/54c602b89138170648c6d993ba258e0434a67b5b))


### Bug Fixes

* **release:** classify generated release documents ([#390](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/390)) ([8d738d1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8d738d1152c70868402f38b26029a4617cfe0b41))

## [0.15.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.15.2...v0.15.3) (2026-08-24)


### Bug Fixes

* **plugin:** compile toolchain binaries for target architectures ([#386](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/386)) ([d3e3f31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d3e3f3128d77c64f8771c640cd9f004bfe0c50b3))

## [0.15.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.15.1...v0.15.2) (2026-08-24)


### Bug Fixes

* **plugin:** rebuild toolchain with patched Go components ([#384](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/384)) ([6e279dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6e279dd732d6be0375b177edb6565629ce173944))

## [0.15.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.15.0...v0.15.1) (2026-08-24)


### Bug Fixes

* **plugin:** align protected publication inputs ([#382](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/382)) ([e963cde](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e963cde624856bfb8048923322dd80ca1216cbad))

## [0.15.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.14.0...v0.15.0) (2026-08-24)


### Features

* **plugin:** add OSS-native Plugin Manager ([#380](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/380)) ([e8416e9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e8416e9abda83b8938e7e7d66bcbbe576811bf58))

## [0.14.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.13.1...v0.14.0) (2026-08-24)


### Features

* **plugin:** introduce product-neutral plugin platform ([#375](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/375)) ([fbf2727](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fbf2727e00e8116ca4051cf33af569986b9e6a49))


### Bug Fixes

* **docker:** enforce source and plugin release contracts ([#379](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/379)) ([1bf8689](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1bf8689c0fd2cdbd0b0eff5fcd0142bcf1b90c40))
* **plugin:** align installer image archives ([#378](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/378)) ([4069cbb](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4069cbb29c467ad653473e870344203d0dff02c4))
* **plugin:** harden bounded file reads ([#377](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/377)) ([d7ff656](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d7ff65657cb41859473f96fe66bfef6920a424ba))

## [0.13.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.13.0...v0.13.1) (2026-08-16)


### Bug Fixes

* **mission-control:** bootstrap engine selection for deep links ([#372](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/372)) ([fb6cbb4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fb6cbb44691ceddfbea5b655a43fe7fc2f1a7b21))

## [0.13.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.12.0...v0.13.0) (2026-08-16)


### Features

* align identity and access administration with Carbon ([#370](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/370)) ([756e3cd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/756e3cd4357c58b6d7848eab8688ae9eeb84b7a8))

## [0.12.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.11.1...v0.12.0) (2026-08-12)


### Features

* **platform-admin:** support complete headless configuration ([#364](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/364)) ([c190036](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c190036bbf17b473bf66714703660a26b88aa5f8))

## [0.11.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.11.0...v0.11.1) (2026-08-10)


### Bug Fixes

* **release:** qualify 0.11.1 image smoke ([#357](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/357)) ([35d36fd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/35d36fd424d1c54cf1b5f8bb219df6f958ebd0ca))
* **release:** refresh moving release notes ref ([#359](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/359)) ([f5c732f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f5c732ff8912553d276bf510b1082d368fcbe766))
* **release:** restore 0.11.1 publication baseline ([#361](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/361)) ([abf3e1d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/abf3e1d7c40ceb580ce9f80e39fac151fc4cc110))

## [0.11.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.7...v0.11.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* **main:** release 0.11.0 ([#351](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/351))
* **authz:** add SSO engine assignments and fine-grained authorization ([#345](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/345))

### Features

* **authz:** add SSO engine assignments and fine-grained authorization ([#345](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/345)) ([1caccf5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1caccf578c0ddcf07d28a4589943e55fce28af7f))


### Bug Fixes

* **ci:** allow pending release publication baseline ([#352](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/352)) ([4aff276](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4aff276389750b855e629545c61dbb89fea6c6bc))
* **ci:** restore release-please baseline after partial publish ([#354](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/354)) ([62af2df](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/62af2df4e8aede757eb5c10ef284b1a29d2a811e))


### Miscellaneous Chores

* **main:** release 0.11.0 ([#351](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/351)) ([cc7d177](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cc7d177f24f15d9b9ba0647aea61b88c5afaa7a3))

## [0.10.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.6...v0.10.7) (2026-08-04)


### Bug Fixes

* **security:** upgrade vulnerable backend dependencies ([#348](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/348)) ([0bfeff9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0bfeff9ca8d8d9ab0f0540cd0858bcf4e1f893e4))

## [0.10.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.5...v0.10.6) (2026-08-04)


### Bug Fixes

* **docker:** make dev.sh backend stack work from a clean checkout ([#344](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/344)) ([727bfc1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/727bfc193dac3b7d65499885e653a32a2a427b55))

## [0.10.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.4...v0.10.5) (2026-08-04)


### Bug Fixes

* **docker:** make dev.sh backend stack work from a clean checkout ([#344](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/344)) ([727bfc1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/727bfc193dac3b7d65499885e653a32a2a427b55))

## [0.10.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.3...v0.10.4) (2026-06-29)


### Bug Fixes

* **ci:** align release smoke Playwright runner image ([#340](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/340)) ([ec440d6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ec440d6b10f81e8aff2acdca48f16d45437d35f9))

## [0.10.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.2...v0.10.3) (2026-06-29)


### Bug Fixes

* **auth:** preserve tenant context through SSO callbacks ([#338](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/338)) ([f5eecc2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f5eecc2037a8c5df84f198c34784194ce2d0e5cb))

## [0.10.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.1...v0.10.2) (2026-06-24)


### Bug Fixes

* **security:** resolve compose and dependency drift ([#335](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/335)) ([2af76e2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2af76e27fe4ed23043298a9d2ba9f048a67972b5))

## [0.10.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.10.0...v0.10.1) (2026-06-02)


### Bug Fixes

* **deps:** patch qs CVE-2026-8723 ([#331](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/331)) ([e88f732](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e88f73261b2d75a084ef27b9cf9173498fc90a5a))

## [0.10.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.9...v0.10.0) (2026-05-17)


### Features

* **mission-control:** add ION-compatible engine adapter context ([#328](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/328)) ([17a1a71](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/17a1a71a0efdc0102cd6db0c9ea56dabb34609d3))

## [0.9.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.8...v0.9.9) (2026-05-17)


### Bug Fixes

* **frontend-host:** allow injected enterprise plugin ([#326](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/326)) ([9d3431e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9d3431ec439dcfb7a482db3e5615ac9f1518f367))

## [0.9.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.7...v0.9.8) (2026-05-17)


### Bug Fixes

* **frontend-host:** route tenant admin settings to EE page ([#324](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/324)) ([f07d906](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f07d906916b33ccc628a96915f28e6230404b310))

## [0.9.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.6...v0.9.7) (2026-05-16)


### Bug Fixes

* **frontend-host:** canonicalize tenant routes ([#322](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/322)) ([354f264](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/354f2647f905863c52bf0dd9d269a14ff9fd179c))

## [0.9.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.5...v0.9.6) (2026-05-16)


### Bug Fixes

* **backend-host:** restore root app API routes ([#320](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/320)) ([95f3170](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/95f3170732960c8cc1fbf72d69b0038f7b2fca60))

## [0.9.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.4...v0.9.5) (2026-05-08)


### Bug Fixes

* **ci:** publish frontend host pnpm tarball ([#318](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/318)) ([9d6e809](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9d6e809c9fd04c204c9569c78342625e5bff9809))

## [0.9.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.3...v0.9.4) (2026-05-08)


### Bug Fixes

* **ci:** repair pnpm package consumption ([#316](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/316)) ([2d0bbff](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2d0bbffef3320371f1e9a9702d38afc8607191e4))

## [0.9.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.2...v0.9.3) (2026-04-26)


### Bug Fixes

* **security:** remediate nightly dependency drift ([#310](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/310)) ([c75342b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c75342b074e829e9801fb093a08d3d72f0b51695))

## [0.9.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.1...v0.9.2) (2026-04-21)


### Miscellaneous Chores

* release 0.9.2 ([#307](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/307)) ([2a0d817](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2a0d81776793667c33501dacdc8f8b08290a602d))

## [0.9.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.9.0...v0.9.1) (2026-04-18)


### Bug Fixes

* **shared:** quote identifiers in AddGitLockSessionState Oracle migration ([#304](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/304)) ([c225e12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c225e128ddf449b3753bb23c7be793fab2c64845))

## [0.9.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.31...v0.9.0) (2026-04-18)


### Features

* **starbase:** add pdf download of process models ([#302](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/302)) ([6d17759](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6d17759fb76c452cc1aa5c201673c25e4d7df7eb))

## [0.8.31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.30...v0.8.31) (2026-04-10)


### Bug Fixes

* **security:** remediate vite dependabot alerts ([#300](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/300)) ([01bc4c3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/01bc4c340c99bac39556b287c0970bdcb3733532))

## [0.8.30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.29...v0.8.30) (2026-04-10)


### Bug Fixes

* **security:** remediate nightly security drift findings ([#298](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/298)) ([68db5bf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/68db5bfa1f5d677598af6f7fb71dae5f218964ca))

## [0.8.29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.28...v0.8.29) (2026-04-02)


### Bug Fixes

* **security:** update lodash to 4.18.0 ([#296](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/296)) ([77ce53d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/77ce53dc2e0d6e45f74dff719266b9473dd97d36))

## [0.8.28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.27...v0.8.28) (2026-04-01)


### Bug Fixes

* **shared:** typeorm uniqueness cleanup ([#293](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/293)) ([8138857](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/8138857baf52bc8b250d00ada6a21df0f32ee4f7))

## [0.8.27](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.26...v0.8.27) (2026-03-31)


### Bug Fixes

* avoid Oracle MERGE ON-clause updates in backfill migrations ([#290](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/290)) ([df82e3c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/df82e3c5c65870eab9445527cd47d3c1224580db))

## [0.8.26](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.25...v0.8.26) (2026-03-31)


### Bug Fixes

* use Oracle MERGE INTO syntax in backfill migrations ([#288](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/288)) ([834c301](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/834c30129846f55cc04300b7ede64917d6328060))

## [0.8.25](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.24...v0.8.25) (2026-03-30)


### Bug Fixes

* **shared:** add db/adapters exports map for deep imports like QueryHelpers.js ([#286](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/286)) ([4193c66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4193c660bcf60fdee582ffad26b879842a5eef2e))

## [0.8.24](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.23...v0.8.24) (2026-03-29)


### Bug Fixes

* **backend:** expose formal notification tenant resolver hook in enterprise plugin API ([#284](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/284)) ([7809010](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7809010dc4d688cdcde2f3675ac91690500493ed))

## [0.8.23](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.22...v0.8.23) (2026-03-29)


### Bug Fixes

* **deps:** remediate security advisories ([#282](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/282)) ([b491c7e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b491c7e0c227b6d454eab1d073b1f3faaa496749))

## [0.8.22](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.21...v0.8.22) (2026-03-29)


### Bug Fixes

* **shared:** refactor entity/service architecture and fix secure cookie handling ([#280](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/280)) ([6a992a3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6a992a3e709631cfed8e292172699f65481236f7))

## [0.8.21](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.20...v0.8.21) (2026-03-27)


### Bug Fixes

* **frontend-host:** build shared before publish ([#278](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/278)) ([11da794](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/11da7941a62e9f2d9ad40b729b115b5662c488dc))

## [0.8.20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.19...v0.8.20) (2026-03-27)


### Bug Fixes

* **frontend-host:** fix publish build errors ([#276](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/276)) ([b0e553c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b0e553c8c558efe3db346d2042a2728931fda044))

## [0.8.19](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.18...v0.8.19) (2026-03-27)


### Bug Fixes

* **frontend:** breadcrumb z-index and branding seed data preservation ([#274](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/274)) ([aacb951](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aacb951d9a4ef63f2688954ac723794f89f39e4e))

## [0.8.18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.17...v0.8.18) (2026-03-27)


### Bug Fixes

* **starbase:** collaboration lock reliability, canvas read-only guard, breadcrumb navigation ([#272](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/272)) ([df86f0a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/df86f0ab91da4309c4dc171b1263cd6306f3c3eb))

## [0.8.17](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.16...v0.8.17) (2026-03-23)


### Bug Fixes

* **ci:** enforce OSS package version discipline ([#270](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/270)) ([151d377](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/151d377f4aca643a01465644b65af9010d19aa70))

## [0.8.16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.15...v0.8.16) (2026-03-23)


### Bug Fixes

* **infra:** harden localhost deploy dependency checks ([#268](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/268)) ([4d0025a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4d0025a152f3be7ed8bb4ea12197cb136546999b))

## [0.8.15](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.14...v0.8.15) (2026-03-23)


### Bug Fixes

* **frontend:** fix starbase breadcrumb drilldown history ([#266](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/266)) ([e5bc4b8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/e5bc4b8796ad500dc9f5e1cb097d90a0c90cca5d))

## [0.8.14](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.13...v0.8.14) (2026-03-23)


### Bug Fixes

* **starbase:** preserve links in project zip export and import ([#264](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/264)) ([603fc8b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/603fc8b6b13044ea893efaef5c6ee0eeeb290ee4))

## [0.8.13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.12...v0.8.13) (2026-03-23)


### Bug Fixes

* **shared:** resolve remaining CodeQL regex alerts ([#262](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/262)) ([2d2af11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2d2af116863b45b09c60f23b5ff191a845a2535d))

## [0.8.12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.11...v0.8.12) (2026-03-22)


### Bug Fixes

* **shared:** resolve CodeQL regex alert ([#260](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/260)) ([34019fd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34019fddab2dc51063cf9a46e4edc0365a18f465))

## [0.8.11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.10...v0.8.11) (2026-03-22)


### Bug Fixes

* **starbase:** refine link overlays and parent usage ([#258](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/258)) ([f056504](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f056504112f175420dac5b15aa0c9e7e92a9ce88))

## [0.8.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.9...v0.8.10) (2026-03-21)


### Bug Fixes

* **auth:** unify invite onboarding and member invite flows ([#256](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/256)) ([5d3dbba](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5d3dbba3adb38719cbb162ea45d0c13e37b0b0cc))

## [0.8.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.8...v0.8.9) (2026-03-20)


### Bug Fixes

* **frontend:** improve auth session persistence ([#254](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/254)) ([4d6270d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/4d6270da0a4d18348356da285f604f37786aff3a))

## [0.8.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.7...v0.8.8) (2026-03-20)


### Bug Fixes

* **starbase:** restore DMN editing and unsaved version state ([#252](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/252)) ([9e284b0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9e284b0aaa933ea7fad79d9194512fe16ab2665b))

## [0.8.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.6...v0.8.7) (2026-03-20)


### Bug Fixes

* **backend:** harden versioning schema integrity ([#250](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/250)) ([2733398](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2733398bac4333880045f6ce96c162d22647a5c8))

## [0.8.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.5...v0.8.6) (2026-03-17)


### Bug Fixes

* **starbase:** scope file versions and restore/delete actions ([#248](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/248)) ([adb045a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/adb045ab612aae8994b3ea34302d50f0be3888ce))

## [0.8.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.4...v0.8.5) (2026-03-16)


### Bug Fixes

* **starbase:** improve linked file create and DMN decision flows ([#245](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/245)) ([b7b26ca](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b7b26ca873ef50312313f74fd5d8c76a697a640f))

## [0.8.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.3...v0.8.4) (2026-03-16)


### Bug Fixes

* **ci:** avoid duplicate merge queue test reruns ([#243](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/243)) ([6686c46](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6686c46fd36784b64eb2f078959f7d48a143a9c8))

## [0.8.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.2...v0.8.3) (2026-03-16)


### Bug Fixes

* **security:** resolve reported security issues in [#240](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/240) ([#241](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/241)) ([846c54f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/846c54f24798501de2b64308c4e8b91930c5a5c7))

## [0.8.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.1...v0.8.2) (2026-03-13)


### Bug Fixes

* **backend:** fix cancelled node-filter instance mismatch ([#238](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/238)) ([f62dc73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f62dc73f01f832c73acd75e0b3784e6fb36577ac))

## [0.8.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.8.0...v0.8.1) (2026-03-13)


### Bug Fixes

* **ci:** keep frontend and backend release images in sync ([#236](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/236)) ([9a4653d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9a4653d0b8e16c1888cf32b960aa346d03151fee))

## [0.8.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.12...v0.8.0) (2026-03-13)


### Features

* add POSTGRES_URL and ORACLE_CONNECTION_STRING connection string support ([#16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/16)) ([5178886](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51788865b812141f260cee2cb5eb06eab6b6d1bf))
* **ci:** add ci-watch helper script for one-command workflow monitoring ([ce42c93](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ce42c930c74532d7365caa7359b0dbaf1cda8644))
* **ci:** add Docker Hub image publishing alongside GHCR ([86ed873](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/86ed873a6fa7b318d1ccc73587059f6c22b002eb))
* **frontend-host:** publish as compiled ESM (IP-01) ([#181](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/181)) ([911ea63](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/911ea634a030a093bce4d454cb88dc8fda97b4af))
* **frontend:** add token pass count toggle on process detail ([#55](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/55)) ([bdd653e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bdd653ed426622b9d8c18e1e04d317cafec67522))
* **mission-control:** add process variable history modal ([#196](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/196)) ([46112fe](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/46112fe6322a50659c48a91c75fe9fe46468754e))
* **mission-control:** extend instance history detail ([#201](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/201)) ([bba23ff](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bba23ffc4e248d28951af9cf6ef37657ab077ad4))
* **plugin-api:** add FrontendPluginContext for dependency injection of host shared utilities ([#61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/61)) ([c47923b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c47923b2811f6ae76a98ddba56a008cd4e1bcba0))
* **security:** add nightly vulnerability drift scan workflow ([#32](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/32)) ([5996d2c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5996d2c3709407667afc7363fdc9e3f1d6b03c78))
* **security:** add Trivy PR gate and release gate with zero-tolerance policy ([#31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/31)) ([30a0c33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/30a0c33b3788fc693d6d1e40c0dce53355c2bc35))
* **selfhost:** add standalone selfhost compose, fix image placeholders, add secret hints ([123b3b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/123b3b4c2803b7fa46f87a065123433875f46f8f))
* **starbase:** import from engine on create ([#57](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/57)) ([93e8a29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/93e8a2925918db9fa9f9291845251d45a8c8ec03))


### Bug Fixes

* allow HTTP engine URLs for localhost/private networks in production ([#18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/18)) ([29fccd0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/29fccd0fa8a1b16bc2f027a2d11641ee18efcf61))
* always grant platform admin role to bootstrap user ([#68](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/68)) ([ef0deee](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ef0deee50e1c655132b2769312a6199495a6b809))
* apply audit rate limiting middleware ([9ea42a4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9ea42a44ebbcfba97ea5363b0b596f8af0361fc0))
* **backend:** gate batch polling by active viewers ([#85](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/85)) ([292a47f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/292a47f160d78b51c09bf7b586271ad9aa27bb03))
* **backend:** handle mixed postgres schemas during schema migration ([#224](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/224)) ([9435671](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/94356716bf41f3c98da4053d2ac51aae1d0f42cb))
* **backend:** honor configured schema ([#86](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/86)) ([7f9e05a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7f9e05a69919394727854d70b575a629038799f1))
* **backend:** local variables shown in global variables ([#50](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/50)) ([baebec2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/baebec2ded9e77ba686f4a18772b8defcf16d57f))
* build backend from repo root ([2f47305](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2f473052f1367577106c8e5e94742c746f1bbc9f))
* **ci:** add actions:read permission to CodeQL workflow ([#168](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/168)) ([d4019dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d4019dd7e3d4ad3847848b65bd009fdcf05fcdd5))
* **ci:** add run_e2e input to skip e2e smoke for EE ([#178](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/178)) ([03855e2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/03855e222ae5a6bf3e5606767a2702bf0cbe4bfb))
* **ci:** also install standalone frontend/ deps for EE ([#175](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/175)) ([5b3d131](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5b3d1316ea299a2f85731ce7861ca241522b7fda))
* **ci:** auto-correct PR title and release label drift ([#28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/28)) ([2c01f28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2c01f28cc59be0478b2fc38214be9e64a04a7647))
* **ci:** clear ENTRYPOINT in runtime contract verification for Chainguard node ([#36](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/36)) ([597217d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/597217d5aba95d3aa285dc097499e85c5f999e07))
* **ci:** declare reusable core token contract ([#146](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/146)) ([eedc2fa](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eedc2faf96200e00aedc149b34899bf7730ea06f))
* **ci:** derive Docker Hub image namespace from DOCKERHUB_USERNAME secret ([ea6db58](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea6db589d960b88782b58941f1d98e756ce19bfc))
* **ci:** install backend deps separately when not a workspace ([#173](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/173)) ([f6e7792](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f6e779200e2fb26c2a536989fc277d9f38b3c965))
* **ci:** make ci-core-reusable.yml build step generic for OSS and EE ([#170](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/170)) ([aea289d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aea289d2b9e38cea1cd43750e31a49ed80c188f0))
* **ci:** make ci-core-reusable.yml compatible with EE repo structure ([#166](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/166)) ([5376769](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5376769c79c6ddc3b422a0e579a31c3c8e50fcd5))
* **ci:** make nightly CI read-only by replacing mutable marker with API lookup ([#38](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/38)) ([cc45720](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cc4572086eef1baa831033452c1362d69e29f217))
* **ci:** pass RELEASE_PLEASE_TOKEN to auto-merge so release PR merge triggers push workflows ([6c5e5b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6c5e5b4738521194266d8c05d358a35feeead18b))
* **ci:** pin peter-evans/repository-dispatch to commit SHA ([#193](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/193)) ([26947e4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/26947e435fd26cc83dd55e0a680a3bd80c75cec7))
* **ci:** rename reusable workflow secret to ci_token ([#149](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/149)) ([1af76df](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1af76dff6f9dec9fc444dcceb390021be3ecb80d))
* **ci:** replace nightly marker git push with GitHub API variable ([#25](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/25)) ([3af7fdd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3af7fdd8bba7a5ab3909127488daf405b2886b83))
* **ci:** resolve Docker publish deadlock and add CVE details to nightly reports ([#47](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/47)) ([9fe949e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9fe949ea76ecdc9a481f979f2040d5539ecee1e4))
* **ci:** trigger release-please on push to main ([#42](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/42)) ([0e4b602](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0e4b6024a928b63233a8d42089a5317d6afa5f9e))
* **ci:** update runtime contract adapter path probe for new dist layout ([#73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/73)) ([d6f0008](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d6f000801253d4a87a0501d6fa64a80c5fd939a6))
* **ci:** use job-level env var for Docker Hub conditional to avoid secrets in if: expressions ([c2c7286](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c2c72861db5397ffba0784114d71d2b9744f145e))
* **deps:** address underscore/tootallnate advisory ([#83](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/83)) ([c40f365](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c40f365576ae93a67db002d1ba91b86296ae1f1a))
* **deps:** override underscore&gt;=1.13.8 and @tootallnate/once&gt;=3.0.1 (CVE-2026-27601, CVE-2026-3449) ([#81](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/81)) ([de520af](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/de520afae150dab57e1b25b43cc86699861aff07))
* **deps:** resolve github security advisories. ([#84](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/84)) ([06257aa](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/06257aa923c298a024ac4b1a1a07bb0a13d988f0))
* **docker:** clarify compose invocation contract ([#7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/7)) ([55732dc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/55732dc2b2dda3d9728bee2f69d899a1ac5fc9ad))
* **docs:** render architecture mermaid diagram ([#215](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/215)) ([a6bc799](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a6bc799597c0e0e40fadd83e091707c1b3fac69f))
* expose auth middleware to enterprise plugin via app.locals ([#39](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/39)) ([eda5d13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eda5d138bd40a9b40a31a581db42fb249a665d6b))
* **frontend-host:** resolve httpInterceptor lint issues ([#188](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/188)) ([63d638c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/63d638c02e5fb7f39b4609fe587f229968af0260))
* **frontend-host:** use dist/ exports directly, add build step to Dockerfile ([#183](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/183)) ([eed2857](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eed2857d39250c1830d054b7295b896df9973cf4))
* **frontend:** align process overview duration formatting ([#203](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/203)) ([fc32aaf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fc32aaf4414e5e040848852d14dcd4904a232daf))
* **frontend:** fix starbase file actions ([#220](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/220)) ([82468c3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/82468c393890a8f33c7a89e16a4acb3532a70792))
* **frontend:** handle nginx error log permissions in k8s ([#231](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/231)) ([0647d67](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0647d67738afed7137fe34361248457ce0fb7001))
* **frontend:** hide empty file structure section ([#199](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/199)) ([6e33e72](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6e33e7250f70a5b01b845d23dbcb7af8c44169a7))
* **frontend:** improve split pane visibility ([#191](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/191)) ([fa2315d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fa2315d042eee96743b803efe5b0345f408eaf31))
* **frontend:** show decision instances for selected version ([#233](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/233)) ([3db1a73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3db1a73e21ae04be2dda9d9e0ca20d97a41287ab))
* **frontend:** stabilize lazy-loaded BPMN and DMN routes ([#229](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/229)) ([b513d3d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b513d3d5c49900871f6328cb19288025b63317ba))
* gitignore node_modules symlinks, fix resolve-dist-imports for EE submodule layout ([#71](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/71)) ([5a8de2f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5a8de2ffd8a10ad02b4dd336bca6cdfc84772bac))
* gracefully handle enterprise plugin on non-postgres databases ([#66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/66)) ([c7e947c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c7e947cc03ed5262f8eb5bb9c04184715866dd91))
* **infra:** align docker improvement docs and deploy ([#213](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/213)) ([bef971b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bef971ba75057edb1b8540203b188ba84b0ba53d))
* **license:** restore complete third-party dependency notices ([#207](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/207)) ([ad5cfd2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ad5cfd28c255770e383edfdfaad496aa0bc55789))
* **mission-control:** expand mock-backed docker smoke coverage ([#209](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/209)) ([6ef02a8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6ef02a8ffa82e47d36bda4533e8990b8f1711748))
* **mission-control:** fix process overview search filtering by name and parent instance ([#52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/52)) ([54bb011](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/54bb0118576da320fda357d322333d19c339c51a))
* **nginx:** make backend host configurable ([#87](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/87)) ([660c1e5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/660c1e521e40f170f85e828f1da8c01e86279977))
* **oracle:** declare oracledb dependency and clarify env config ([#64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/64)) ([ab27c12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab27c128f6670bee30ec2ab198c65d49d33e8777))
* **oracle:** dedupe Oracle bootstrap indexes ([#4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/4)) ([140f5dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/140f5dd454fa468842f017bae8abde0700dec3cc))
* pin lodash-es to 4.17.23 ([d7e3f1e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d7e3f1e5bbd0a2d20967638a72821130bb2c0513))
* proxy tenant-scoped API routes in dev ([05f61cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05f61cf7c06a01a98693c02292e04632f58e00e9))
* refresh mission control menu and gate image smoke checks ([#20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/20)) ([33bfeaf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/33bfeafb18b1fd6772c58edb99abfb511171651f))
* resolve Open Redirect in useOnlineProjectWizard.ts and Dashboard.tsx ([0bb79bd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0bb79bd3750189c0242849c21396c22f86ef452d))
* resolve remaining CodeQL security alerts ([#190](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/190), [#192](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/192), [#187](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/187)) ([59ebbe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/59ebbe037e11ca27b845ec5e288b7a18911ff885))
* resolve Snyk DOM XSS and Open Redirect vulnerabilities (CWE-79, CWE-601) ([1b4d7f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1b4d7f93e997fdd2945fd429e1b511499fbe80d2))
* **security:** address 2 code scanning findings ([#94](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/94)) ([219de3c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/219de3c25affd24f2429a7a50eee83d5aea17bb4))
* **security:** address all 47 github code scanning alerts ([#171](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/171)) ([11e3acd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/11e3acd41eb92df9d072927080805a700e782cdc))
* **security:** address codeql incomplete multi-character sanitization ([#97](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/97)) ([15cb2b5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/15cb2b53b0a66eb28bbbb446d252028234857265))
* **security:** address issues reported in [#219](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/219) ([#222](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/222)) ([05ca030](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05ca030d374b0661b43874108521219c9f8deaeb))
* **security:** bump minimatch override to ^10.2.4 ([#40](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/40)) ([44fc3e6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/44fc3e6cc10c18260349136523a0ccde1a4818e2))
* **security:** harden editor redirects and harvester output ([#211](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/211)) ([fd952e7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fd952e75550192e8c6424fb629bd70b1bade6675))
* **security:** strip npm from runtime image to eliminate base-image CVEs ([#44](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/44)) ([9b584d5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9b584d58e3be4e16d63583f12d89755c8d8c56e5))
* **security:** trivy security fixes ([#27](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/27)) ([0ce7cb1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0ce7cb12d1fc35069c09f09881178a547276fb12))
* **security:** update minimatch and fast-xml-parser transitive deps ([#33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/33)) ([34ff726](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34ff72614d4dacea6210f501792221188fc8a64a))
* **security:** update rollup to 4.59.0 (CVE-2026-27606) ([#30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/30)) ([7b34401](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7b344014f59008b1834caa9cbbdeca9115359fc5))
* support legacy migration generate route ([5e89371](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5e893719ff8f400567254be2a9ea866d4201d558))

## [0.7.12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.11...v0.7.12) (2026-03-13)


### Bug Fixes

* **frontend:** show decision instances for selected version ([#233](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/233)) ([3db1a73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3db1a73e21ae04be2dda9d9e0ca20d97a41287ab))

## [0.7.11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.10...v0.7.11) (2026-03-13)


### Bug Fixes

* **frontend:** handle nginx error log permissions in k8s ([#231](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/231)) ([0647d67](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0647d67738afed7137fe34361248457ce0fb7001))

## [0.7.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.9...v0.7.10) (2026-03-13)


### Bug Fixes

* **frontend:** stabilize lazy-loaded BPMN and DMN routes ([#229](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/229)) ([b513d3d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/b513d3d5c49900871f6328cb19288025b63317ba))

## [0.7.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.8...v0.7.9) (2026-03-12)


### Bug Fixes

* **backend:** handle mixed postgres schemas during schema migration ([#224](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/224)) ([9435671](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/94356716bf41f3c98da4053d2ac51aae1d0f42cb))

## [0.7.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.7...v0.7.8) (2026-03-12)


### Bug Fixes

* **security:** address issues reported in [#219](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/219) ([#222](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/222)) ([05ca030](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05ca030d374b0661b43874108521219c9f8deaeb))

## [0.7.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.6...v0.7.7) (2026-03-12)


### Bug Fixes

* **frontend:** fix starbase file actions ([#220](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/220)) ([82468c3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/82468c393890a8f33c7a89e16a4acb3532a70792))

## [0.7.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.5...v0.7.6) (2026-03-10)


### Bug Fixes

* **docs:** render architecture mermaid diagram ([#215](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/215)) ([a6bc799](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/a6bc799597c0e0e40fadd83e091707c1b3fac69f))

## [0.7.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.4...v0.7.5) (2026-03-10)


### Bug Fixes

* **infra:** align docker improvement docs and deploy ([#213](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/213)) ([bef971b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bef971ba75057edb1b8540203b188ba84b0ba53d))

## [0.7.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.3...v0.7.4) (2026-03-10)


### Bug Fixes

* **security:** harden editor redirects and harvester output ([#211](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/211)) ([fd952e7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fd952e75550192e8c6424fb629bd70b1bade6675))

## [0.7.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.2...v0.7.3) (2026-03-10)


### Bug Fixes

* **mission-control:** expand mock-backed docker smoke coverage ([#209](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/209)) ([6ef02a8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6ef02a8ffa82e47d36bda4533e8990b8f1711748))

## [0.7.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.1...v0.7.2) (2026-03-09)


### Bug Fixes

* **license:** restore complete third-party dependency notices ([#207](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/207)) ([ad5cfd2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ad5cfd28c255770e383edfdfaad496aa0bc55789))

## [0.7.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.7.0...v0.7.1) (2026-03-08)


### Bug Fixes

* **frontend:** align process overview duration formatting ([#203](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/203)) ([fc32aaf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fc32aaf4414e5e040848852d14dcd4904a232daf))

## [0.7.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.6.1...v0.7.0) (2026-03-08)


### Features

* **mission-control:** extend instance history detail ([#201](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/201)) ([bba23ff](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bba23ffc4e248d28951af9cf6ef37657ab077ad4))

## [0.6.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.6.0...v0.6.1) (2026-03-08)


### Bug Fixes

* **frontend:** hide empty file structure section ([#199](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/199)) ([6e33e72](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6e33e7250f70a5b01b845d23dbcb7af8c44169a7))

## [0.6.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.5.4...v0.6.0) (2026-03-08)


### Features

* **mission-control:** add process variable history modal ([#196](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/196)) ([46112fe](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/46112fe6322a50659c48a91c75fe9fe46468754e))

## [0.5.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.5.3...v0.5.4) (2026-03-07)


### Bug Fixes

* **ci:** pin peter-evans/repository-dispatch to commit SHA ([#193](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/193)) ([26947e4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/26947e435fd26cc83dd55e0a680a3bd80c75cec7))

## [0.5.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.5.2...v0.5.3) (2026-03-07)


### Bug Fixes

* **frontend:** improve split pane visibility ([#191](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/191)) ([fa2315d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/fa2315d042eee96743b803efe5b0345f408eaf31))

## [0.5.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.5.1...v0.5.2) (2026-03-07)


### Bug Fixes

* **frontend-host:** resolve httpInterceptor lint issues ([#188](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/188)) ([63d638c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/63d638c02e5fb7f39b4609fe587f229968af0260))

## [0.5.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.5.0...v0.5.1) (2026-03-07)


### Bug Fixes

* **frontend-host:** use dist/ exports directly, add build step to Dockerfile ([#183](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/183)) ([eed2857](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eed2857d39250c1830d054b7295b896df9973cf4))

## [0.5.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.40...v0.5.0) (2026-03-07)


### Features

* **frontend-host:** publish as compiled ESM (IP-01) ([#181](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/181)) ([911ea63](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/911ea634a030a093bce4d454cb88dc8fda97b4af))

## [0.4.40](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.39...v0.4.40) (2026-03-07)


### Bug Fixes

* **ci:** add run_e2e input to skip e2e smoke for EE ([#178](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/178)) ([03855e2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/03855e222ae5a6bf3e5606767a2702bf0cbe4bfb))

## [0.4.39](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.38...v0.4.39) (2026-03-07)


### Bug Fixes

* **security:** address all 47 github code scanning alerts ([#171](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/171)) ([11e3acd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/11e3acd41eb92df9d072927080805a700e782cdc))

## [0.4.38](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.37...v0.4.38) (2026-03-07)


### Bug Fixes

* **ci:** also install standalone frontend/ deps for EE ([#175](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/175)) ([5b3d131](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5b3d1316ea299a2f85731ce7861ca241522b7fda))

## [0.4.37](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.36...v0.4.37) (2026-03-07)


### Bug Fixes

* **ci:** install backend deps separately when not a workspace ([#173](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/173)) ([f6e7792](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/f6e779200e2fb26c2a536989fc277d9f38b3c965))

## [0.4.36](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.35...v0.4.36) (2026-03-07)


### Bug Fixes

* **ci:** make ci-core-reusable.yml build step generic for OSS and EE ([#170](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/170)) ([aea289d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/aea289d2b9e38cea1cd43750e31a49ed80c188f0))

## [0.4.35](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.34...v0.4.35) (2026-03-07)


### Bug Fixes

* **ci:** add actions:read permission to CodeQL workflow ([#168](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/168)) ([d4019dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d4019dd7e3d4ad3847848b65bd009fdcf05fcdd5))

## [0.4.34](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.33...v0.4.34) (2026-03-07)


### Bug Fixes

* **ci:** make ci-core-reusable.yml compatible with EE repo structure ([#166](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/166)) ([5376769](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5376769c79c6ddc3b422a0e579a31c3c8e50fcd5))

## [0.4.33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.32...v0.4.33) (2026-03-06)


### Bug Fixes

* **ci:** rename reusable workflow secret to ci_token ([#149](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/149)) ([1af76df](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1af76dff6f9dec9fc444dcceb390021be3ecb80d))

## [0.4.32](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.31...v0.4.32) (2026-03-06)


### Bug Fixes

* **ci:** declare reusable core token contract ([#146](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/146)) ([eedc2fa](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eedc2faf96200e00aedc149b34899bf7730ea06f))

## [0.4.31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.30...v0.4.31) (2026-03-06)


### Bug Fixes

* **security:** address codeql incomplete multi-character sanitization ([#97](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/97)) ([15cb2b5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/15cb2b53b0a66eb28bbbb446d252028234857265))

## [0.4.30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.29...v0.4.30) (2026-03-05)


### Bug Fixes

* **security:** address 2 code scanning findings ([#94](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/94)) ([219de3c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/219de3c25affd24f2429a7a50eee83d5aea17bb4))

## [0.4.29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.28...v0.4.29) (2026-03-05)


### Bug Fixes

* **nginx:** make backend host configurable ([#87](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/87)) ([660c1e5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/660c1e521e40f170f85e828f1da8c01e86279977))

## [0.4.28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.27...v0.4.28) (2026-03-05)


### Bug Fixes

* **backend:** honor configured schema ([#86](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/86)) ([7f9e05a](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7f9e05a69919394727854d70b575a629038799f1))

## [0.4.27](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.26...v0.4.27) (2026-03-05)


### Bug Fixes

* **deps:** resolve github security advisories. ([#84](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/84)) ([06257aa](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/06257aa923c298a024ac4b1a1a07bb0a13d988f0))

## [0.4.26](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.25...v0.4.26) (2026-03-05)


### Bug Fixes

* **backend:** gate batch polling by active viewers ([#85](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/85)) ([292a47f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/292a47f160d78b51c09bf7b586271ad9aa27bb03))

## [0.4.25](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.24...v0.4.25) (2026-03-05)


### Bug Fixes

* **deps:** address underscore/tootallnate advisory ([#83](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/83)) ([c40f365](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c40f365576ae93a67db002d1ba91b86296ae1f1a))

## [0.4.24](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.23...v0.4.24) (2026-03-05)


### Bug Fixes

* **deps:** override underscore&gt;=1.13.8 and @tootallnate/once&gt;=3.0.1 (CVE-2026-27601, CVE-2026-3449) ([#81](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/81)) ([de520af](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/de520afae150dab57e1b25b43cc86699861aff07))

## [0.4.23](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.22...v0.4.23) (2026-03-03)


### Bug Fixes

* **ci:** update runtime contract adapter path probe for new dist layout ([#73](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/73)) ([d6f0008](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d6f000801253d4a87a0501d6fa64a80c5fd939a6))

## [0.4.22](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.21...v0.4.22) (2026-03-03)


### Bug Fixes

* gitignore node_modules symlinks, fix resolve-dist-imports for EE submodule layout ([#71](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/71)) ([5a8de2f](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5a8de2ffd8a10ad02b4dd336bca6cdfc84772bac))

## [0.4.21](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.20...v0.4.21) (2026-03-02)


### Bug Fixes

* always grant platform admin role to bootstrap user ([#68](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/68)) ([ef0deee](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ef0deee50e1c655132b2769312a6199495a6b809))

## [0.4.20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.19...v0.4.20) (2026-03-02)


### Bug Fixes

* gracefully handle enterprise plugin on non-postgres databases ([#66](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/66)) ([c7e947c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c7e947cc03ed5262f8eb5bb9c04184715866dd91))

## [0.4.19](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.18...v0.4.19) (2026-03-02)


### Bug Fixes

* **oracle:** declare oracledb dependency and clarify env config ([#64](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/64)) ([ab27c12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ab27c128f6670bee30ec2ab198c65d49d33e8777))

## [0.4.18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.17...v0.4.18) (2026-03-02)


### Features

* **plugin-api:** add FrontendPluginContext for dependency injection of host shared utilities ([#61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/61)) ([c47923b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c47923b2811f6ae76a98ddba56a008cd4e1bcba0))

## [0.4.17](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.16...v0.4.17) (2026-03-01)


### Features

* **plugin-api:** add FrontendPluginContext for dependency injection of host shared utilities ([#61](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/61)) ([c47923b](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c47923b2811f6ae76a98ddba56a008cd4e1bcba0))

## [0.4.16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.15...v0.4.16) (2026-03-01)


### Features

* **starbase:** import from engine on create ([#57](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/57)) ([93e8a29](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/93e8a2925918db9fa9f9291845251d45a8c8ec03))

## [0.4.15](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.14...v0.4.15) (2026-02-28)


### Features

* **frontend:** add token pass count toggle on process detail ([#55](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/55)) ([bdd653e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/bdd653ed426622b9d8c18e1e04d317cafec67522))

## [0.4.14](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.13...v0.4.14) (2026-02-28)


### Bug Fixes

* **mission-control:** fix process overview search filtering by name and parent instance ([#52](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/52)) ([54bb011](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/54bb0118576da320fda357d322333d19c339c51a))

## [0.4.13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.12...v0.4.13) (2026-02-28)


### Bug Fixes

* **backend:** local variables shown in global variables ([#50](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/50)) ([baebec2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/baebec2ded9e77ba686f4a18772b8defcf16d57f))

## [0.4.12](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.11...v0.4.12) (2026-02-28)


### Bug Fixes

* **ci:** resolve Docker publish deadlock and add CVE details to nightly reports ([#47](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/47)) ([9fe949e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9fe949ea76ecdc9a481f979f2040d5539ecee1e4))

## [0.4.11](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.10...v0.4.11) (2026-02-27)


### Bug Fixes

* **security:** strip npm from runtime image to eliminate base-image CVEs ([#44](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/44)) ([9b584d5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9b584d58e3be4e16d63583f12d89755c8d8c56e5))

## [0.4.10](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.9...v0.4.10) (2026-02-27)


### Bug Fixes

* **ci:** trigger release-please on push to main ([#42](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/42)) ([0e4b602](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0e4b6024a928b63233a8d42089a5317d6afa5f9e))

## [0.4.9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.8...v0.4.9) (2026-02-27)


### Bug Fixes

* **ci:** make nightly CI read-only by replacing mutable marker with API lookup ([#38](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/38)) ([cc45720](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/cc4572086eef1baa831033452c1362d69e29f217))
* expose auth middleware to enterprise plugin via app.locals ([#39](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/39)) ([eda5d13](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/eda5d138bd40a9b40a31a581db42fb249a665d6b))
* **security:** bump minimatch override to ^10.2.4 ([#40](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/40)) ([44fc3e6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/44fc3e6cc10c18260349136523a0ccde1a4818e2))

## [0.4.8](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.7...v0.4.8) (2026-02-26)


### Bug Fixes

* **ci:** clear ENTRYPOINT in runtime contract verification for Chainguard node ([#36](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/36)) ([597217d](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/597217d5aba95d3aa285dc097499e85c5f999e07))

## [0.4.7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.6...v0.4.7) (2026-02-26)


### Features

* **security:** add nightly vulnerability drift scan workflow ([#32](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/32)) ([5996d2c](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5996d2c3709407667afc7363fdc9e3f1d6b03c78))
* **security:** add Trivy PR gate and release gate with zero-tolerance policy ([#31](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/31)) ([30a0c33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/30a0c33b3788fc693d6d1e40c0dce53355c2bc35))


### Bug Fixes

* **security:** update minimatch and fast-xml-parser transitive deps ([#33](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/33)) ([34ff726](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/34ff72614d4dacea6210f501792221188fc8a64a))
* **security:** update rollup to 4.59.0 (CVE-2026-27606) ([#30](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/30)) ([7b34401](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/7b344014f59008b1834caa9cbbdeca9115359fc5))

## [0.4.6](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.5...v0.4.6) (2026-02-26)


### Bug Fixes

* **ci:** auto-correct PR title and release label drift ([#28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/28)) ([2c01f28](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2c01f28cc59be0478b2fc38214be9e64a04a7647))

## [0.4.5](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.4...v0.4.5) (2026-02-26)


### Bug Fixes

* **ci:** replace nightly marker git push with GitHub API variable ([#25](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/25)) ([3af7fdd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/3af7fdd8bba7a5ab3909127488daf405b2886b83))

## [0.4.4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.3...v0.4.4) (2026-02-23)


### Bug Fixes

* refresh mission control menu and gate image smoke checks ([#20](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/20)) ([33bfeaf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/33bfeafb18b1fd6772c58edb99abfb511171651f))

## [0.4.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.2...v0.4.3) (2026-02-23)


### Bug Fixes

* allow HTTP engine URLs for localhost/private networks in production ([#18](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/18)) ([29fccd0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/29fccd0fa8a1b16bc2f027a2d11641ee18efcf61))

## [0.4.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.1...v0.4.2) (2026-02-23)


### Features

* add POSTGRES_URL and ORACLE_CONNECTION_STRING connection string support ([#16](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/16)) ([5178886](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/51788865b812141f260cee2cb5eb06eab6b6d1bf))

## [0.4.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.4.0...v0.4.1) (2026-02-23)


### Bug Fixes

* **ci:** pass RELEASE_PLEASE_TOKEN to auto-merge so release PR merge triggers push workflows ([6c5e5b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/6c5e5b4738521194266d8c05d358a35feeead18b))

## [0.4.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.2...v0.4.0) (2026-02-23)


### Features

* **ci:** add ci-watch helper script for one-command workflow monitoring ([ce42c93](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ce42c930c74532d7365caa7359b0dbaf1cda8644))

## [0.3.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.1...v0.3.2) (2026-02-23)


### Bug Fixes

* **ci:** derive Docker Hub image namespace from DOCKERHUB_USERNAME secret ([ea6db58](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/ea6db589d960b88782b58941f1d98e756ce19bfc))

## [0.3.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.3.0...v0.3.1) (2026-02-23)


### Bug Fixes

* **ci:** use job-level env var for Docker Hub conditional to avoid secrets in if: expressions ([c2c7286](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/c2c72861db5397ffba0784114d71d2b9744f145e))

## [0.3.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.2.0...v0.3.0) (2026-02-23)


### Features

* **selfhost:** add standalone selfhost compose, fix image placeholders, add secret hints ([123b3b4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/123b3b4c2803b7fa46f87a065123433875f46f8f))

## [0.2.0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.3...v0.2.0) (2026-02-23)


### Features

* **ci:** add Docker Hub image publishing alongside GHCR ([86ed873](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/86ed873a6fa7b318d1ccc73587059f6c22b002eb))

## [0.1.3](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.2...v0.1.3) (2026-02-23)


### Bug Fixes

* **docker:** clarify compose invocation contract ([#7](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/7)) ([55732dc](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/55732dc2b2dda3d9728bee2f69d899a1ac5fc9ad))

## [0.1.2](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.1...v0.1.2) (2026-02-22)


### Bug Fixes

* **oracle:** dedupe Oracle bootstrap indexes ([#4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/4)) ([140f5dd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/140f5dd454fa468842f017bae8abde0700dec3cc))

## [0.1.1](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/compare/v0.1.0...v0.1.1) (2026-02-22)


### Bug Fixes

* apply audit rate limiting middleware ([9ea42a4](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/9ea42a44ebbcfba97ea5363b0b596f8af0361fc0))
* build backend from repo root ([2f47305](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/2f473052f1367577106c8e5e94742c746f1bbc9f))
* pin lodash-es to 4.17.23 ([d7e3f1e](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/d7e3f1e5bbd0a2d20967638a72821130bb2c0513))
* proxy tenant-scoped API routes in dev ([05f61cf](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/05f61cf7c06a01a98693c02292e04632f58e00e9))
* resolve Open Redirect in useOnlineProjectWizard.ts and Dashboard.tsx ([0bb79bd](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/0bb79bd3750189c0242849c21396c22f86ef452d))
* resolve remaining CodeQL security alerts ([#190](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/190), [#192](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/192), [#187](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/issues/187)) ([59ebbe0](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/59ebbe037e11ca27b845ec5e288b7a18911ff885))
* resolve Snyk DOM XSS and Open Redirect vulnerabilities (CWE-79, CWE-601) ([1b4d7f9](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/1b4d7f93e997fdd2945fd429e1b511499fbe80d2))
* support legacy migration generate route ([5e89371](https://github.com/EnterpriseGlue/enterpriseglue-the-bridge-oss/commit/5e893719ff8f400567254be2a9ea866d4201d558))

## [0.1.0] - 2026-02-22

### Added
- Initial release governance scaffolding:
  - Release Please workflow and manifest/config
  - Release policy workflow for release labels and breaking-change notes
  - Docker image publishing workflow with smoke checks
  - Image deployment compose overlays and env templates

### Changed
- Added containerized smoke coverage for image deployments (Postgres and Oracle), including Nginx-proxied auth and Playwright smoke tests.
