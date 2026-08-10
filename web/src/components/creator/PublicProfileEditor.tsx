"use client";

import {
  useEffect,
  useState,
} from "react";
import {
  useWallet,
} from "@solana/wallet-adapter-react";

import {
  KODIAK_NETWORK,
} from "@/lib/solana/network";

type Meta = {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string;
  xUrl: string;
  telegramUrl: string;
  websiteUrl: string;
};

type SignedProfilePayload = {
  wallet: string;
  network: string;
  issuedAt: string;
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string;
  xUrl: string;
  telegramUrl: string;
  websiteUrl: string;
  avatarSha256: string;
};

function normalizeUsername(
  value: string,
) {
  return value
    .trim()
    .slice(
      0,
      24,
    )
    .replace(
      /[^a-zA-Z0-9_]/g,
      "",
    );
}

export function PublicProfileEditor({
  wallet,
  initial,
  onSaved,
}: {
  wallet: string;
  initial: Meta;
  onSaved: (
    meta: Meta,
  ) => void;
}) {
  const {
    publicKey,
    signMessage,
  } =
    useWallet();

  const owns =
    publicKey?.toBase58() ===
    wallet;

  const [
    editing,
    setEditing,
  ] =
    useState(false);

  const [
    form,
    setForm,
  ] =
    useState(initial);

  const [
    avatarFile,
    setAvatarFile,
  ] =
    useState<File | null>(
      null,
    );

  const [
    avatarPreview,
    setAvatarPreview,
  ] =
    useState("");

  const [
    status,
    setStatus,
  ] =
    useState("");

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  useEffect(() => {
    setForm(
      initial,
    );
  }, [
    initial,
  ]);

  useEffect(() => {
    if (
      !avatarFile
    ) {
      setAvatarPreview(
        "",
      );

      return;
    }

    const objectUrl =
      URL.createObjectURL(
        avatarFile,
      );

    setAvatarPreview(
      objectUrl,
    );

    return () => {
      URL.revokeObjectURL(
        objectUrl,
      );
    };
  }, [
    avatarFile,
  ]);

  if (!owns) {
    return null;
  }

  const field = (
    key:
      keyof Meta,
    label:
      string,
    placeholder:
      string,
  ) => (
    <label className="grid gap-2 text-sm font-bold text-zinc-300">
      <span>
        {label}
      </span>

      <input
        value={
          form[key]
        }
        onChange={(
          event,
        ) =>
          setForm(
            (
              current,
            ) => ({
              ...current,
              [key]:
                event.target
                  .value,
            }),
          )
        }
        placeholder={
          placeholder
        }
        className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-normal text-white outline-none focus:border-emerald-400/50"
      />
    </label>
  );

  async function sha256File(
    file: File,
  ) {
    const digest =
      await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );

    return Array.from(
      new Uint8Array(
        digest,
      ),
    )
      .map(
        (value) =>
          value
            .toString(16)
            .padStart(
              2,
              "0",
            ),
      )
      .join(
        "",
      );
  }

  async function save() {
    if (
      !signMessage
    ) {
      setStatus(
        "This wallet does not support message signing.",
      );

      return;
    }

    try {
      setSaving(
        true,
      );

      const avatarSha256 =
        avatarFile
          ? await sha256File(
              avatarFile,
            )
          : "";

      const signedPayload:
        SignedProfilePayload = {
        wallet,
        network:
          KODIAK_NETWORK,
        issuedAt:
          new Date().toISOString(),
        displayName:
          form.displayName
            .trim()
            .slice(
              0,
              50,
            ),
        username:
          normalizeUsername(
            form.username,
          ),
        bio:
          form.bio
            .trim()
            .slice(
              0,
              280,
            ),
        avatarUrl:
          form.avatarUrl.trim(),
        xUrl:
          form.xUrl.trim(),
        telegramUrl:
          form.telegramUrl.trim(),
        websiteUrl:
          form.websiteUrl.trim(),
        avatarSha256,
      };

      const signedPayloadText =
        JSON.stringify(
          signedPayload,
        );

      setStatus(
        "Waiting for wallet signature...",
      );

      const signed =
        await signMessage(
          new TextEncoder().encode(
            signedPayloadText,
          ),
        );

      const signature =
        btoa(
          String.fromCharCode(
            ...signed,
          ),
        );

      setStatus(
        avatarFile
          ? "Uploading profile picture and saving profile..."
          : "Saving profile...",
      );

      const outgoing =
        new FormData();

      outgoing.append(
        "signedPayload",
        signedPayloadText,
      );

      outgoing.append(
        "signature",
        signature,
      );

      if (
        avatarFile
      ) {
        outgoing.append(
          "avatar",
          avatarFile,
          avatarFile.name ||
            "profile-image",
        );
      }

      const response =
        await fetch(
          `/api/creator/${encodeURIComponent(
            wallet,
          )}/profile`,
          {
            method:
              "PUT",
            body:
              outgoing,
          },
        );

      const data =
        (await response.json()) as {
          profile?: Meta;
          error?: string;
        };

      if (
        !response.ok ||
        !data.profile
      ) {
        throw new Error(
          data.error ||
            "Unable to save profile.",
        );
      }

      setForm(
        data.profile,
      );

      setAvatarFile(
        null,
      );

      setAvatarPreview(
        "",
      );

      onSaved(
        data.profile,
      );

      setEditing(
        false,
      );

      setStatus(
        "Profile saved.",
      );
    } catch (
      error
    ) {
      setStatus(
        error instanceof
          Error
          ? error.message
          : "Unable to save profile.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  if (
    !editing
  ) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() =>
            setEditing(
              true,
            )
          }
          className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black"
        >
          Edit public
          profile
        </button>

        {status && (
          <p className="mt-2 text-xs text-zinc-500">
            {status}
          </p>
        )}
      </div>
    );
  }

  const visibleAvatar =
    avatarPreview ||
    form.avatarUrl;

  return (
    <section className="mt-6 rounded-2xl border border-emerald-400/20 bg-black/30 p-5">
      <div className="grid gap-5">
        <div>
          <p className="text-sm font-bold text-zinc-300">
            Profile picture
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-amber-300/30 bg-amber-300/10 text-2xl font-black text-amber-300">
              {visibleAvatar ? (
                <img
                  src={
                    visibleAvatar
                  }
                  alt="Profile preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                wallet.slice(
                  0,
                  2,
                )
              )}
            </div>

            <div className="min-w-0 flex-1">
              <label className="inline-flex cursor-pointer rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-black">
                Choose photo

                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(
                    event,
                  ) => {
                    const file =
                      event.target.files?.[0] ??
                      null;

                    if (
                      file &&
                      file.size >
                        5 *
                          1024 *
                          1024
                    ) {
                      setAvatarFile(
                        null,
                      );

                      setStatus(
                        "Profile picture must be 5 MB or smaller.",
                      );

                      event.target.value =
                        "";

                      return;
                    }

                    setAvatarFile(
                      file,
                    );

                    setStatus(
                      "",
                    );
                  }}
                />
              </label>

              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Pick an image directly
                from your phone or photo
                library. Maximum size:
                5 MB.
              </p>

              {(avatarFile ||
                form.avatarUrl) && (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarFile(
                      null,
                    );

                    setAvatarPreview(
                      "",
                    );

                    setForm(
                      (
                        current,
                      ) => ({
                        ...current,
                        avatarUrl:
                          "",
                      }),
                    );
                  }}
                  className="mt-2 text-xs font-black text-red-300"
                >
                  Remove profile
                  picture
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            "displayName",
            "Display name",
            "Kodiak creator",
          )}

          {field(
            "username",
            "Username",
            "creator_name",
          )}

          {field(
            "websiteUrl",
            "Website",
            "https://...",
          )}

          {field(
            "xUrl",
            "X profile",
            "https://x.com/...",
          )}

          {field(
            "telegramUrl",
            "Telegram",
            "https://t.me/...",
          )}

          <label className="grid gap-2 text-sm font-bold text-zinc-300 sm:col-span-2">
            <span>
              Bio
            </span>

            <textarea
              maxLength={
                280
              }
              rows={
                4
              }
              value={
                form.bio
              }
              onChange={(
                event,
              ) =>
                setForm(
                  (
                    current,
                  ) => ({
                    ...current,
                    bio:
                      event.target
                        .value,
                  }),
                )
              }
              className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-normal text-white outline-none focus:border-emerald-400/50"
            />
          </label>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={
            saving
          }
          onClick={() =>
            void save()
          }
          className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : "Sign & save"}
        </button>

        <button
          type="button"
          disabled={
            saving
          }
          onClick={() => {
            setEditing(
              false,
            );

            setAvatarFile(
              null,
            );

            setAvatarPreview(
              "",
            );

            setForm(
              initial,
            );

            setStatus(
              "",
            );
          }}
          className="rounded-xl border border-white/10 px-4 py-3 text-sm font-black disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {status && (
        <p className="mt-3 text-xs text-zinc-400">
          {status}
        </p>
      )}
    </section>
  );
}
