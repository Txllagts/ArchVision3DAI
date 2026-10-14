import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  createDefaultScene,
  createDemoHouseScene,
  computeSceneMetrics,
  slugify,
} from "@archvision/shared";
import type { SceneDocument } from "@archvision/types";

/**
 * Semilla de datos.
 *
 * Contenido realista de arquitectura (nada de "Test 1" ni lorem ipsum):
 * una cuenta de demostracion con la casa demo de dos plantas y dos proyectos
 * adicionales en distintos estados para poblar el dashboard.
 */

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@archvision.app";
const DEMO_PASSWORD = "arquitectura2026";

async function upsertSceneFor(projectId: string, scene: SceneDocument) {
  const dataJson = JSON.stringify(scene);
  await prisma.scene.upsert({
    where: { projectId },
    create: { projectId, dataJson, schemaVersion: scene.version },
    update: { dataJson, schemaVersion: scene.version },
  });
  return Buffer.byteLength(dataJson, "utf8");
}

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      email: DEMO_EMAIL,
      name: "Ana Restrepo",
      passwordHash,
      role: "PROFESSIONAL",
      plan: "pro",
      emailVerifiedAt: new Date(),
      preferences: JSON.stringify({ theme: "dark", defaultUnit: "m" }),
    },
    update: { passwordHash },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: slugify("Estudio Restrepo Arquitectura") },
    create: {
      name: "Estudio Restrepo Arquitectura",
      slug: slugify("Estudio Restrepo Arquitectura"),
      ownerId: user.id,
      members: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
    update: {},
  });

  // --- Proyecto demo: casa de dos plantas ---------------------------------
  const demoScene = createDemoHouseScene();
  const demoMetrics = computeSceneMetrics(demoScene);

  const demoProject = await prisma.project.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      workspaceId: workspace.id,
      ownerId: user.id,
      name: "Casa Los Robles",
      description:
        "Vivienda unifamiliar de dos plantas, 80 m2 por nivel, cubierta a dos aguas y fachada en ladrillo.",
      type: "house",
      units: "m",
      creationMethod: "draw",
      status: "ready",
      progress: 100,
      location: "Bucaramanga, Colombia",
      floorsCount: demoScene.floors.length,
      areaEstimate: Math.round(demoMetrics.usableArea * 100) / 100,
      floorHeight: 2.9,
    },
    update: {},
  });

  const demoSize = await upsertSceneFor(demoProject.id, demoScene);
  await prisma.project.update({
    where: { id: demoProject.id },
    data: { sizeBytes: demoSize },
  });

  await prisma.projectVersion.createMany({
    data: [
      {
        projectId: demoProject.id,
        label: "Version inicial",
        dataJson: JSON.stringify(demoScene),
        createdById: user.id,
      },
    ],
  });

  // --- Proyectos adicionales para poblar el dashboard ---------------------
  const extras = [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Apartamento Cabecera 1203",
      description:
        "Remodelacion de apartamento de 96 m2: integracion de cocina y sala, nuevo bano principal.",
      type: "apartment",
      status: "processing",
      progress: 62,
      location: "Bucaramanga, Colombia",
      floorsCount: 1,
      areaEstimate: 96,
      creationMethod: "floorplan",
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Local comercial Cra 33",
      description:
        "Levantamiento a partir de fotografias de fachada para propuesta de vitrina y aviso.",
      type: "commercial",
      status: "draft",
      progress: 0,
      location: "Bucaramanga, Colombia",
      floorsCount: 1,
      areaEstimate: 120,
      creationMethod: "photos",
    },
  ] as const;

  for (const extra of extras) {
    const project = await prisma.project.upsert({
      where: { id: extra.id },
      create: {
        id: extra.id,
        workspaceId: workspace.id,
        ownerId: user.id,
        name: extra.name,
        description: extra.description,
        type: extra.type,
        units: "m",
        creationMethod: extra.creationMethod,
        status: extra.status,
        progress: extra.progress,
        location: extra.location,
        floorsCount: extra.floorsCount,
        areaEstimate: extra.areaEstimate,
        floorHeight: 2.6,
      },
      update: {},
    });

    const scene = createDefaultScene({ floorsCount: extra.floorsCount });
    const size = await upsertSceneFor(project.id, scene);
    await prisma.project.update({
      where: { id: project.id },
      data: { sizeBytes: size },
    });
  }

  console.log("Semilla completada.");
  console.log(`  Usuario demo: ${DEMO_EMAIL}`);
  console.log(`  Contraseña:   ${DEMO_PASSWORD}`);
  console.log(`  Workspace:    ${workspace.name}`);
  console.log(`  Proyectos:    ${1 + extras.length}`);
}

main()
  .catch((error: unknown) => {
    console.error("Error ejecutando la semilla:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
