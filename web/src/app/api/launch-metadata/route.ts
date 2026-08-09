import { NextResponse } from "next/server";

import {
  KODIAK_NETWORK,
  kodiakNetworkLabel,
} from "@/lib/solana/network";

const PINATA_FILE_URL =
  "https://api.pinata.cloud/pinning/pinFileToIPFS";

const PINATA_JSON_URL =
  "https://api.pinata.cloud/pinning/pinJSONToIPFS";

const PUBLIC_GATEWAY =
  "https://gateway.pinata.cloud/ipfs";

type PinataResponse = {
  IpfsHash?: string;
  error?: string;
};

function cleanOptionalUrl(
  value: FormDataEntryValue | null,
) {
  if (
    typeof value !== "string"
  ) {
    return undefined;
  }

  const trimmed =
    value.trim();

  return trimmed ||
    undefined;
}

export async function POST(
  request: Request,
) {
  const jwt =
    process.env.PINATA_JWT;

  if (!jwt) {
    return NextResponse.json(
      {
        error:
          "Metadata storage is not configured. Add PINATA_JWT to the Vercel project environment variables.",
      },
      {
        status: 503,
      },
    );
  }

  try {
    const incoming =
      await request.formData();

    const image =
      incoming.get("image");

    const name =
      String(
        incoming.get(
          "name",
        ) ?? "",
      ).trim();

    const symbol =
      String(
        incoming.get(
          "symbol",
        ) ?? "",
      )
        .replace(
          "$",
          "",
        )
        .trim()
        .toUpperCase();

    const description =
      String(
        incoming.get(
          "description",
        ) ?? "",
      ).trim();

    if (
      !(image instanceof File) ||
      image.size === 0
    ) {
      return NextResponse.json(
        {
          error:
            "A token image is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !name ||
      !symbol ||
      !description
    ) {
      return NextResponse.json(
        {
          error:
            "Name, symbol, and description are required.",
        },
        {
          status: 400,
        },
      );
    }

    const imageUpload =
      new FormData();

    imageUpload.append(
      "file",
      image,
      image.name ||
        `${symbol}-logo.png`,
    );

    imageUpload.append(
      "pinataMetadata",
      JSON.stringify({
        name:
          `${name} token image`,
      }),
    );

    const imageResponse =
      await fetch(
        PINATA_FILE_URL,
        {
          method:
            "POST",
          headers: {
            Authorization:
              `Bearer ${jwt}`,
          },
          body:
            imageUpload,
        },
      );

    const imagePayload =
      (await imageResponse.json()) as PinataResponse;

    if (
      !imageResponse.ok ||
      !imagePayload.IpfsHash
    ) {
      throw new Error(
        imagePayload.error ||
          `Image upload failed with HTTP ${imageResponse.status}.`,
      );
    }

    const imageUrl =
      `${PUBLIC_GATEWAY}/${imagePayload.IpfsHash}`;

    const website =
      cleanOptionalUrl(
        incoming.get(
          "website",
        ),
      );

    const twitter =
      cleanOptionalUrl(
        incoming.get(
          "x",
        ),
      );

    const telegram =
      cleanOptionalUrl(
        incoming.get(
          "telegram",
        ),
      );

    const discord =
      cleanOptionalUrl(
        incoming.get(
          "discord",
        ),
      );

    const networkLabel =
      kodiakNetworkLabel();

    const metadata = {
      name,
      symbol,
      description,
      image:
        imageUrl,
      external_url:
        website,
      attributes: [
        {
          trait_type:
            "Launchpad",
          value:
            "Kodiak",
        },
        {
          trait_type:
            "Network",
          value:
            `Solana ${networkLabel}`,
        },
      ],
      properties: {
        category:
          "image",
        files: [
          {
            uri:
              imageUrl,
            type:
              image.type ||
              "image/png",
          },
        ],
        creators: [],
      },
      extensions: {
        website,
        twitter,
        telegram,
        discord,
      },
    };

    const metadataResponse =
      await fetch(
        PINATA_JSON_URL,
        {
          method:
            "POST",
          headers: {
            Authorization:
              `Bearer ${jwt}`,
            "Content-Type":
              "application/json",
          },
          body:
            JSON.stringify({
              pinataMetadata: {
                name:
                  `${name} token metadata`,
              },
              pinataContent:
                metadata,
            }),
        },
      );

    const metadataPayload =
      (await metadataResponse.json()) as PinataResponse;

    if (
      !metadataResponse.ok ||
      !metadataPayload.IpfsHash
    ) {
      throw new Error(
        metadataPayload.error ||
          `Metadata upload failed with HTTP ${metadataResponse.status}.`,
      );
    }

    return NextResponse.json({
      network:
        KODIAK_NETWORK,
      uri:
        `${PUBLIC_GATEWAY}/${metadataPayload.IpfsHash}`,
      image:
        imageUrl,
      metadataCid:
        metadataPayload.IpfsHash,
      imageCid:
        imagePayload.IpfsHash,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to upload token metadata.",
        network:
          KODIAK_NETWORK,
      },
      {
        status: 500,
      },
    );
  }
}
