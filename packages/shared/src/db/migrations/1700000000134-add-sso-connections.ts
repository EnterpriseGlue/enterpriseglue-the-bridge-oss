import { TableColumn } from "typeorm";
import type { MigrationInterface, QueryRunner } from "typeorm";
import { portableText } from "./support/portable-columns.js";

export class AddSsoConnections1700000000134 implements MigrationInterface {
  name = "AddSsoConnections1700000000134";
  async up(q: QueryRunner): Promise<void> {
    for (const [entity, columns] of [
      ["PlatformSettings", ["sso_proxy_catalogue_json", "sso_connection_json"]],
      ["TenantLoginPolicy", ["sso_connection_json"]],
    ] as const) {
      const table = q.connection.getMetadata(entity).tablePath;
      for (const name of columns)
        if (!(await q.hasColumn(table, name)))
          await q.addColumn(
            table,
            new TableColumn({
              name,
              ...portableText(q, "large"),
              isNullable: true,
            }),
          );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    for (const [entity, fields] of [
      ["PlatformSettings", ["ssoProxyCatalogueJson", "ssoConnectionJson"]],
      ["TenantLoginPolicy", ["ssoConnectionJson"]],
    ] as const) {
      const rows = await q.manager
        .getRepository(entity)
        .find({ select: [...fields] });
      if (rows.some((row) => fields.some((field) => row[field])))
        throw new Error(
          "Remove scoped SSO configuration through a reviewed migration before downgrading",
        );
    }
    for (const [entity, columns] of [
      ["PlatformSettings", ["sso_proxy_catalogue_json", "sso_connection_json"]],
      ["TenantLoginPolicy", ["sso_connection_json"]],
    ] as const) {
      const table = q.connection.getMetadata(entity).tablePath;
      for (const name of columns)
        if (await q.hasColumn(table, name)) await q.dropColumn(table, name);
    }
  }
}
