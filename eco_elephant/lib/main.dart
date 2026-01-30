import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

void main() {
  runApp(const EcoElephantApp());
}

class EcoElephantApp extends StatelessWidget {
  const EcoElephantApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '경제코끼리',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1E3A8A)),
        useMaterial3: true,
      ),
      home: const HotTopicsHome(),
    );
  }
}

class HotTopicsHome extends StatefulWidget {
  const HotTopicsHome({super.key});

  @override
  State<HotTopicsHome> createState() => _HotTopicsHomeState();
}

class _HotTopicsHomeState extends State<HotTopicsHome> {
  late Future<HotTopicsResponse> _future;

  @override
  void initState() {
    super.initState();
    _future = fetchTodayTopics();
  }

  Future<void> _refresh() async {
    setState(() {
      _future = fetchTodayTopics();
    });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('경제코끼리'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
            tooltip: '새로고침',
          ),
        ],
      ),
      body: FutureBuilder<HotTopicsResponse>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            final err = snapshot.error;
            final message = err is NotFoundError
                ? '오늘 데이터가 아직 없어요.'
                : '불러오기에 실패했어요.';
            return _ErrorView(message: message, onRetry: _refresh);
          }
          final data = snapshot.data!;
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _Header(date: data.date),
                const SizedBox(height: 16),
                _SectionTitle(title: 'KR 핫토픽'),
                const SizedBox(height: 8),
                ...data.kr.map((t) => _TopicCard(topic: t)),
                const SizedBox(height: 16),
                _SectionTitle(title: 'WORLD 핫토픽'),
                const SizedBox(height: 8),
                ...data.world.map((t) => _TopicCard(topic: t)),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.date});

  final String date;

  @override
  Widget build(BuildContext context) {
    final pretty = formatDate(date);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          const Text('🐘', style: TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('오늘의 경제 핫토픽'),
                const SizedBox(height: 4),
                Text(
                  pretty,
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
    );
  }
}

class _TopicCard extends StatelessWidget {
  const _TopicCard({required this.topic});

  final HotTopic topic;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TopicDetailPage(topic: topic),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                topic.title,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: -6,
                children: topic.tags
                    .map((t) => Chip(
                          label: Text(t),
                          visualDensity: VisualDensity.compact,
                        ))
                    .toList(),
              ),
              const SizedBox(height: 8),
              ...topic.summary.map((s) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text('• $s'),
                  )),
            ],
          ),
        ),
      ),
    );
  }
}

class TopicDetailPage extends StatelessWidget {
  const TopicDetailPage({super.key, required this.topic});

  final HotTopic topic;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('핫토픽 상세')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            topic.title,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: -6,
            children: topic.tags
                .map((t) => Chip(
                      label: Text(t),
                      visualDensity: VisualDensity.compact,
                    ))
                .toList(),
          ),
          const SizedBox(height: 16),
          const Text('요약', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ...topic.summary.map((s) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('• $s'),
              )),
          const SizedBox(height: 16),
          const Text('왜 중요한가', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(topic.whyItMatters),
          const SizedBox(height: 16),
          const Text('근거 링크', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ...topic.sources.map(
            (u) => ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(u),
              trailing: const Icon(Icons.open_in_new),
              onTap: () => openUrl(u),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: onRetry,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      ),
    );
  }
}

class NotFoundError implements Exception {}

class HotTopic {
  HotTopic({
    required this.id,
    required this.title,
    required this.summary,
    required this.whyItMatters,
    required this.sources,
    required this.tags,
  });

  final String id;
  final String title;
  final List<String> summary;
  final String whyItMatters;
  final List<String> sources;
  final List<String> tags;

  factory HotTopic.fromJson(Map<String, dynamic> json) {
    return HotTopic(
      id: String(json['id'] ?? ''),
      title: String(json['title'] ?? ''),
      summary: (json['summary'] as List? ?? []).map((e) => '$e').toList(),
      whyItMatters: String(json['why_it_matters'] ?? ''),
      sources: (json['sources'] as List? ?? []).map((e) => '$e').toList(),
      tags: (json['tags'] as List? ?? []).map((e) => '$e').toList(),
    );
  }
}

class HotTopicsResponse {
  HotTopicsResponse({required this.date, required this.kr, required this.world});

  final String date;
  final List<HotTopic> kr;
  final List<HotTopic> world;

  factory HotTopicsResponse.fromJson(Map<String, dynamic> json) {
    return HotTopicsResponse(
      date: String(json['date'] ?? todayKstString()),
      kr: (json['kr'] as List? ?? [])
          .map((e) => HotTopic.fromJson(e))
          .toList(),
      world: (json['world'] as List? ?? [])
          .map((e) => HotTopic.fromJson(e))
          .toList(),
    );
  }
}

const String rawBaseUrl = String.fromEnvironment(
  'RAW_BASE_URL',
  defaultValue:
      'https://raw.githubusercontent.com/rlagusghvv/Economic-Elephant/main/out',
);

const String dateOverride =
    String.fromEnvironment('DATE_OVERRIDE', defaultValue: '');

String todayKstString() {
  final nowKst = DateTime.now().toUtc().add(const Duration(hours: 9));
  final yyyy = nowKst.year.toString().padLeft(4, '0');
  final mm = nowKst.month.toString().padLeft(2, '0');
  final dd = nowKst.day.toString().padLeft(2, '0');
  return '$yyyy$mm$dd';
}

String formatDate(String yyyymmdd) {
  if (yyyymmdd.length != 8) return yyyymmdd;
  final y = yyyymmdd.substring(0, 4);
  final m = yyyymmdd.substring(4, 6);
  final d = yyyymmdd.substring(6, 8);
  return '$y.$m.$d';
}

Future<HotTopicsResponse> fetchTodayTopics() async {
  final date = dateOverride.isNotEmpty ? dateOverride : todayKstString();
  final url =
      '$rawBaseUrl/daily_topics_$date.json?ek_ts=${DateTime.now().millisecondsSinceEpoch}';

  final res = await http.get(Uri.parse(url));
  if (res.statusCode == 404) throw NotFoundError();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw Exception('HTTP ${res.statusCode}');
  }

  final json = jsonDecode(res.body) as Map<String, dynamic>;
  return HotTopicsResponse.fromJson(json);
}

Future<void> openUrl(String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}
