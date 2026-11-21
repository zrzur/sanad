/** Build a public CDN URL for a Zrzur file (avatar, icon, …). */
export async function fileUrl(client, file) {
  if (!file) return null;
  const id = typeof file === "string" ? file : file._id;
  const tag = typeof file === "string" ? "avatars" : file.tag || "avatars";
  if (!id) return null;
  try {
    const base = await client.rest.filesUrl();
    return `${base}/${tag}/${id}`;
  } catch {
    return `https://cdn.zrzur.com/${tag}/${id}`;
  }
}

export async function userAvatarUrl(client, user) {
  if (!user?.avatar) return null;
  return fileUrl(client, user.avatar);
}
